import { PublicKey, SystemProgram } from '@solana/web3.js';
import { program, wallet } from '../utils/solana.js';
import { supabase } from '../utils/supabase.js';
import { uploadJson, uploadFile } from '../services/ipfsService.js';
import sha256 from 'crypto-js/sha256.js';
import BN from 'bn.js';
const BATCH_SEED = 'batch';
const STAGE_SEED = 'stage';

/**
 * Gera um ID de lote único e legível (ex: FSN-2025-001).
 * @param {string} producerName - O nome do produtor para gerar as iniciais.
 * @param {object} supabase - A instância do cliente Supabase.
 * @returns {Promise<string>} O próximo ID único disponível.
 */
const generateUniqueBatchId = async (producerName, supabase) => {
    if (!producerName) throw new Error("Producer name is required to generate a batch ID.");

    const year = new Date().getFullYear();
    const initials = producerName
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase();

    const idPrefix = `${initials}-${year}-`;

    // Busca no DB o último lote com o mesmo prefixo para encontrar o maior sequencial.
    const { data: lastBatch, error } = await supabase
        .from('batches')
        .select('onchain_id')
        .like('onchain_id', `${idPrefix}%`)
        .order('onchain_id', { ascending: false })
        .limit(1)
        .single();
        
    if (error && error.code !== 'PGRST116') { // PGRST116 é o erro "No rows found", que é esperado.
        throw error;
    }

    let nextSequence = 1;
    if (lastBatch) {
        const lastSequenceStr = lastBatch.onchain_id.split('-').pop();
        const lastSequence = parseInt(lastSequenceStr, 10);
        nextSequence = lastSequence + 1;
    }

    // Formata o número com zeros à esquerda (ex: 1 -> "001", 12 -> "012")
    const nextSequenceFormatted = String(nextSequence).padStart(3, '0');
    
    return `${idPrefix}${nextSequenceFormatted}`;
};
export const createBatch = async (req, res) => {
    // ✨ MUDANÇA: 'id' foi removido. Agora recebemos 'producerName' para gerar o ID.
    const { producerName, brandOwnerKey, initialHolderKey, participants, ...metadata } = req.body;

    if (!producerName || !brandOwnerKey || !initialHolderKey) {
        return res.status(400).json({ error: 'producerName, brandOwnerKey e initialHolderKey são obrigatórios.' });
    }

    const MAX_RETRIES = 3; // Tenta até 3 vezes em caso de conflito de ID.
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            // ✨ MUDANÇA: Geramos o ID único aqui no backend.
            const uniqueBatchId = await generateUniqueBatchId(producerName, supabase);
            console.log(`Tentativa ${attempt}: Gerando lote com ID ${uniqueBatchId}`);

            const brandOwnerPk = new PublicKey(brandOwnerKey);
            const initialHolderPk = new PublicKey(initialHolderKey);
            
            const batchDataHash = sha256(JSON.stringify({ producerName, ...metadata })).toString();
            // O PDA agora é derivado do ID que NÓS geramos.
            const [batchPda] = await PublicKey.findProgramAddress([Buffer.from(BATCH_SEED), Buffer.from(uniqueBatchId)], program.programId);

            // --- Passo 1: Transação On-chain ---
            const txSignature = await program.methods
                .createBatch(uniqueBatchId, producerName || '', batchDataHash, initialHolderPk)
                .accounts({
                    batch: batchPda,
                    brandOwner: brandOwnerPk,
                    payer: wallet.publicKey,
                    system_program: PublicKey.default,
                })
                .rpc();

            // --- Passo 2: Se a transação on-chain for bem-sucedida, salvar no cache do Supabase ---
            const batchAddress = batchPda.toBase58();

            const { error: batchError } = await supabase.from('batches').insert({
                id: batchAddress, // PK da tabela é o endereço da conta (PDA)
                brand_owner_key: brandOwnerKey,
                onchain_id: uniqueBatchId, // O ID legível que geramos
                producer_name: producerName,
                onchain_created_at: new Date().toISOString(),
                current_holder_key: initialHolderKey,
                status: 'inProgress',
                onchain_next_stage_index: 0,
            });

            if (batchError) throw batchError;

            // --- Passo 3: Adicionar os participantes ---
            if (participants && participants.length > 0) {
                const participantRows = participants.map(partnerId => ({
                    batch_id: batchAddress,
                    partner_id: partnerId,
                }));
                const { error: participantsError } = await supabase.from('batch_participants').insert(participantRows);
                if (participantsError) throw participantsError;
            }

            // Se tudo deu certo, retorna o sucesso e sai do loop.
            return res.status(201).json({ 
                message: 'Lote criado com sucesso!',
                transaction: txSignature,
                batchAddress: batchAddress,
                batchId: uniqueBatchId, // ✨ MUDANÇA: Retorna o ID gerado para o frontend.
            });

        } catch (error) {
            // Verifica se o erro é de "conta já existe", indicando uma race condition.
            const isCollisionError = error.message.includes("already in use") || (error.code && error.code === '23505'); // 23505 é erro de unicidade no Postgres/Supabase
            
            if (isCollisionError && attempt < MAX_RETRIES) {
                console.warn(`Colisão de ID na tentativa ${attempt}. Retentando...`);
                // O loop continuará para a próxima tentativa.
                continue;
            }
            
            // Se não for um erro de colisão ou se já esgotamos as tentativas, retorna o erro.
            console.error(`Erro final ao criar lote na tentativa ${attempt}:`, error);
            return res.status(500).json({ error: error.message });
        }
    }
    
    // Se o loop terminar sem sucesso.
    return res.status(500).json({ error: "Não foi possível criar o lote após múltiplas tentativas devido a conflitos." });
};
export const addParticipants = async (req, res) => {
    try {
        // Pega o ID do lote dos parâmetros da URL
        const { id: batchId } = req.params; 
        
        // Pega a lista de IDs de parceiros do corpo da requisição
        const { participantIds } = req.body;

        if (!batchId || !participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
            return res.status(400).json({ error: 'batchId e uma lista de participantIds são obrigatórios.' });
        }

        // Mapeia os IDs para o formato que a tabela 'batch_participants' espera
        const participantRows = participantIds.map(partnerId => ({
            batch_id: batchId,
            partner_id: partnerId,
        }));

        // Insere as novas linhas no Supabase
        const { data, error } = await supabase
            .from('batch_participants')
            .insert(participantRows)
            .select();

        if (error) {
            // Se houver um erro de chave duplicada (tentando adicionar alguém que já existe), podemos tratá-lo
            if (error.code === '23505') { // Código de erro do Postgres para violação de unicidade
                return res.status(409).json({ error: 'Um ou mais participantes já existem neste lote.', details: error.details });
            }
            throw error;
        }

        res.status(201).json({ message: `${data.length} participante(s) adicionado(s) com sucesso.`, data });

    } catch (error) {
        console.error("Erro ao adicionar participantes ao lote:", error);
        res.status(500).json({ error: error.message });
    }
};
export const removeParticipant = async (req, res) => {
    try {
        const { batchId, partnerId } = req.params;
        const { brandOwnerKey } = req.body; // A chave do dono da marca para verificação

        if (!brandOwnerKey) {
            return res.status(401).json({ error: 'Chave do Dono da Marca é necessária para autorização.' });
        }

        // --- Verificação de Autorização e Regra de Negócio ---
        // 1. Busca os dados do lote para verificar o dono e o responsável atual.
        const { data: batchData, error: batchError } = await supabase
            .from('batches')
            .select('brand_owner_key, current_holder_key')
            .eq('id', batchId)
            .single();

        if (batchError) throw batchError;

        // 2. Garante que quem está pedindo a remoção é o Dono da Marca.
        if (batchData.brand_owner_key !== brandOwnerKey) {
            return res.status(403).json({ error: 'Apenas o Dono da Marca pode remover participantes.' });
        }

        // 3. Busca a chave pública do parceiro que se quer remover.
        const { data: partnerData, error: partnerError } = await supabase
            .from('partners')
            .select('public_key')
            .eq('id', partnerId)
            .single();
            
        if (partnerError) throw partnerError;

        // 4. IMPEDE a remoção se o participante for o responsável atual.
        if (batchData.current_holder_key === partnerData.public_key) {
            return res.status(400).json({ error: 'Não é possível remover o participante que é o responsável atual pelo lote.' });
        }

        // --- Execução da Remoção ---
        const { error: deleteError, count } = await supabase
            .from('batch_participants')
            .delete()
            .match({
                batch_id: batchId,
                partner_id: partnerId
            });
            
        if (deleteError) throw deleteError;

        if (count === 0) {
            return res.status(404).json({ error: 'Participante não encontrado neste lote.' });
        }

        res.status(200).json({ message: 'Participante removido com sucesso!' });

    } catch (error) {
        console.error("Erro ao remover participante:", error);
        res.status(500).json({ error: error.message });
    }
};
// GET /api/batches - Listar lotes do usuário (lendo do cache rápido do Supabase)
export const getMyBatches = async (req, res) => {
    try {
        const userKey = req.query.user;
        if (!userKey) {
            return res.status(400).json({ error: 'O parâmetro de query "user" é obrigatório.' });
        }

        // Busca lotes onde o usuário é o dono OU o detentor atual da posse
        const { data, error } = await supabase
            .from('batches')
            .select('*')
            .or(`brand_owner_key.eq.${userKey},current_holder_key.eq.${userKey}`);
            
        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error("Erro ao listar lotes:", error);
        res.status(500).json({ error: error.message });
    }
};

// GET /api/batches/:id - Detalhes de um lote
export const getBatchDetails = async (req, res) => {
    const { id: batchId } = req.params;

    try {
        // --- PASSO 1: BUSCAR DADOS DO CACHE ---
        const { data: batchCache, error: batchError } = await supabase
            .from('batches')
            .select('*')
            .eq('id', batchId)
            .single();

        if (batchError || !batchCache) {
            return res.status(404).json({ error: "Lote não encontrado no cache." });
        }
        
        const { data: partnersData, error: partnersError } = await supabase
            .from('batch_participants')
            .select('*, partner:partners(*)')
            .eq('batch_id', batchId);
        
        if (partnersError) {
            return res.status(400).json({ error: "Não foi possível buscar os parceiros do lote." });
        }

        // --- PASSO 2: BUSCAR DADOS ON-CHAIN ---
        const batchPubKey = new PublicKey(batchId);
        
        const batchOnChain = await program.account.batch.fetch(batchPubKey);
        const stageCount = batchOnChain.nextStageIndex;

        // --- PASSO 3: BUSCAR CONTAS DE ETAPA ---
        let stagesData = [];
        if (stageCount > 0) {
            const stagePdaPromises = [];
            for (let i = 0; i < stageCount; i++) {
                stagePdaPromises.push(
                    PublicKey.findProgramAddress(
                        [Buffer.from(STAGE_SEED), batchPubKey.toBuffer(), new BN(i).toBuffer('le', 2)],
                        program.programId
                    )
                );
            }
            const stagePdaInfos = await Promise.all(stagePdaPromises);
            const stagePdas = stagePdaInfos.map(info => info[0]);
            
            const stagesAccounts = await program.account.stage.fetchMultiple(stagePdas);
            stagesData = stagesAccounts.filter(acc => acc !== null);
        }

        // --- PASSO 4: COMBINAR E RETORNAR A RESPOSTA ---
        const responsePayload = {
            details: {
                ...batchCache,
                // ✨ CORREÇÃO: Usando (partnersData || []) para evitar erro se não houver parceiros
                batch_participants: (partnersData || []).map(p => ({ partner: p.partner }))
            },
            stages: stagesData
        };
        
        return res.status(200).json(responsePayload);

    } catch (chainError) {
        console.error("Erro ao buscar dados on-chain:", chainError);
        return res.status(500).json({ error: "Falha ao buscar dados da blockchain." });
    }
};

export const addStage = async (req, res) => {
    try {
        const { id: batchAddress } = req.params;
        const { stageName, notes, userKey, partnerType, formData } = req.body;
        const file = req.file;

        // Validações básicas
        if (!stageName || !userKey || !partnerType) {
            return res.status(400).json({ 
                error: 'Nome da etapa, tipo de parceiro e chave do usuário são obrigatórios.' 
            });
        }

        // Busca o estado mais recente do lote da blockchain
        const batchOnChain = await program.account.batch.fetch(new PublicKey(batchAddress));
        
        // Verifica se o usuário é o detentor atual
        if (batchOnChain.currentHolder.toBase58() !== userKey) {
            return res.status(403).json({ 
                error: 'Apenas o detentor atual da posse pode adicionar uma etapa.' 
            });
        }

        // --- FLUXO DE UPLOAD OFF-CHAIN ---

        let attachmentUrl = null;
        if (file) {
            console.log("Iniciando upload do anexo para o IPFS...");
            attachmentUrl = await uploadFile(file); 
            console.log("Anexo enviado, URL:", attachmentUrl);
        }

        // Processa os dados do formulário baseado no tipo de parceiro
        let parsedFormData = {};
        try {
            parsedFormData = formData ? JSON.parse(formData) : {};
        } catch (parseError) {
            console.warn("Erro ao analisar formData, usando objeto vazio:", parseError);
        }

        // Constrói metadados ricos baseados no tipo de parceiro
        const stageMetadata = {
            name: stageName,
            partnerType: partnerType,
            timestamp: new Date().toISOString(),
            addedBy: userKey,
            notes: notes || '',
            attachment: attachmentUrl,
            // Inclui todos os dados específicos do formulário
            ...parsedFormData
        };

        // Faz upload dos metadados para o IPFS
        const ipfsCid = await uploadJson(stageMetadata);
        if (!ipfsCid) {
            throw new Error('Falha ao fazer upload dos metadados para o IPFS.');
        }

        // --- FLUXO ON-CHAIN ---

        const batchPubKey = new PublicKey(batchAddress);
        const stageIndex = batchOnChain.nextStageIndex;
        
        const [stagePda] = await PublicKey.findProgramAddress(
            [Buffer.from(STAGE_SEED), batchPubKey.toBuffer(), new BN(stageIndex).toBuffer('le', 2)],
            program.programId
        );
        
        // Transação on-chain com o CID do IPFS
        const txSignature = await program.methods
            .addStage(stageName, ipfsCid)
            .accounts({
                batch: batchPubKey,
                stage: stagePda,
                actor: new PublicKey(userKey),
                payer: wallet.publicKey,
                system_program: SystemProgram.programId,
            })
            .rpc();

        // Atualiza o cache no Supabase
        const { error: updateError } = await supabase
            .from('batches')
            .update({ 
                onchain_next_stage_index: stageIndex + 1,
                updated_at: new Date().toISOString()
            })
            .eq('id', batchAddress);

        if (updateError) {
            console.warn(`Cache update failed after tx ${txSignature}`, updateError);
        }

        // Registra a etapa no Supabase para consulta rápida
        const { error: stageLogError } = await supabase
            .from('stage_logs')
            .insert({
                batch_id: batchAddress,
                stage_index: stageIndex,
                partner_type: partnerType,
                added_by: userKey,
                ipfs_cid: ipfsCid,
                transaction_signature: txSignature,
                created_at: new Date().toISOString()
            });

        if (stageLogError) {
            console.warn("Failed to log stage in Supabase:", stageLogError);
        }

        res.status(201).json({
            message: 'Etapa adicionada com sucesso!',
            transaction: txSignature,
            stageAddress: stagePda.toBase58(),
            ipfsCid: ipfsCid,
            partnerType: partnerType,
            metadata: stageMetadata
        });

    } catch (error) {
        console.error("Erro ao adicionar etapa:", error);
        res.status(500).json({ error: error.message });
    }
}
export const getWorkstationBatches = async (req, res) => {
    try {
        const { user } = req.query;
        if (!user) {
            return res.status(400).json({ error: 'O parâmetro de query "user" é obrigatório.' });
        }

        // Busca no cache do Supabase apenas os lotes em andamento que estão sob a posse do utilizador
        const { data, error } = await supabase
            .from('batches')
            .select('*')
            .eq('current_holder_key', user)
            .eq('status', 'inProgress');

        if (error) throw error;

        res.status(200).json(data);

    } catch (error) {
        console.error("Erro ao buscar lotes da workstation:", error);
        res.status(500).json({ error: error.message });
    }
};

// ✨ NOVO: GET /api/stages/history - Para a página "Meu Histórico" do Parceiro
export const getActorHistory = async (req, res) => {
    try {
        const { user } = req.query;
        if (!user) {
            return res.status(400).json({ error: 'O parâmetro de query "user" é obrigatório.' });
        }

        // --- Leitura Direta da Blockchain ---
        
        // NOTA DE PERFORMANCE: A abordagem abaixo busca TODAS as contas 'Stage' do programa
        // e depois filtra no lado do servidor. Para um número pequeno de etapas, isso funciona bem.
        // Para uma aplicação em larga escala, o ideal seria usar um serviço de indexação
        // ou filtros mais avançados (se a estrutura da sua conta permitir).

        // 1. Busca todas as contas do tipo 'stage'
        const allStages = await program.account.stage.all();
        
        // 2. Filtra as contas onde o 'actor' é o usuário que fez a requisição
        const userHistory = allStages.filter(stageAccount => 
            stageAccount.account.actor.toBase58() === user
        );

        // Opcional: Enriquecer os dados. Para cada etapa, buscar o nome do lote no cache.
        const enrichedHistory = await Promise.all(userHistory.map(async (stage) => {
            const { data: batchInfo } = await supabase
                .from('batches')
                .select('onchain_id, producer_name')
                .eq('id', stage.account.batch.toBase58())
                .single();
            
            return {
                ...stage.account,
                batchOnchainId: batchInfo?.onchain_id || 'N/A',
                batchProducerName: batchInfo?.producer_name || 'N/A',
                publicKey: stage.publicKey.toBase58() // Adiciona a chave da própria conta de etapa
            };
        }));

        res.status(200).json(enrichedHistory);

    } catch (error) {
        console.error("Erro ao buscar histórico do ator:", error);
        res.status(500).json({ error: error.message });
    }
};
// POST /api/batches/:id/transfer - Transferir posse
export const transferCustody = async (req, res) => {
    const { currentHolderKey, newHolderPartnerId } = req.body;
    const batchAddress = req.params.id;

    try {
        // --- Passo 1: Verificações de segurança no Supabase ---
        const { data: batchData, error: batchDbError } = await supabase
            .from('batches').select('current_holder_key').eq('id', batchAddress).single();
        if (batchDbError || batchData.current_holder_key !== currentHolderKey) {
            return res.status(403).json({ error: "Apenas o detentor atual pode transferir a posse." });
        }

        const { data: participant, error: checkError } = await supabase
            .from('batch_participants').select('*, partner:partners(public_key)').eq('batch_id', batchAddress).eq('partner_id', newHolderPartnerId).single();
        if (checkError || !participant) {
            return res.status(403).json({ error: "O parceiro de destino não está autorizado para este lote." });
        }
        const newHolderOnChainKey = new PublicKey(participant.partner.public_key);

        // --- Passo 2: Transação On-chain ---
        const txSignature = await program.methods
            .transferCustody(newHolderOnChainKey)
            .accounts({
                batch: new PublicKey(batchAddress),
                currentHolder: new PublicKey(currentHolderKey),
                payer: wallet.publicKey,
            })
            .rpc();

        // --- Passo 3: Atualizar o cache no Supabase ---
        const { error: updateError } = await supabase
            .from('batches').update({ current_holder_key: newHolderOnChainKey.toBase58() }).eq('id', batchAddress);
        if (updateError) throw updateError;
        
        res.status(200).json({ message: 'Posse transferida com sucesso!', transaction: txSignature });
    } catch (error) {
        console.error("Erro ao transferir posse:", error);
        res.status(500).json({ error: error.message });
    }
};

// POST /api/batches/:id/finalize - Finalizar lote
export const finalizeBatch = async (req, res) => {
    const { brandOwnerKey } = req.body;
    const batchAddress = req.params.id;

    try {
        // --- Passo 1: Verificação de segurança no Supabase ---
        const { data: batchData, error: dbError } = await supabase
            .from('batches').select('brand_owner_key').eq('id', batchAddress).single();
        if (dbError || batchData.brand_owner_key !== brandOwnerKey) {
            return res.status(403).json({ error: "Apenas o Dono da Marca pode finalizar o lote." });
        }

        // --- Passo 2: Transação On-chain ---
        const txSignature = await program.methods.finalizeBatch().accounts({
            batch: new PublicKey(batchAddress),
            brandOwner: new PublicKey(brandOwnerKey),
            payer: wallet.publicKey,
        }).rpc();

        // --- Passo 3: Atualizar o cache no Supabase ---
        const { error: updateError } = await supabase
            .from('batches').update({ status: 'completed' }).eq('id', batchAddress);
        if (updateError) throw updateError;

        res.status(200).json({ message: 'Lote finalizado com sucesso!', transaction: txSignature });
    } catch (error) {
        console.error("Erro ao finalizar lote:", error);
        res.status(500).json({ error: error.message });
    }
};