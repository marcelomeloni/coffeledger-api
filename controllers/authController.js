// backend/api/auth.js (atualizado)
import { supabase } from '../utils/supabase.js';

export const checkUserRole = async (req, res) => {
    const { publicKey } = req.body;

    console.log('🔐 Recebida solicitação de verificação de role para:', publicKey);

    if (!publicKey) {
        console.warn('❌ Chave pública não fornecida');
        return res.status(400).json({ error: 'A chave pública é obrigatória.' });
    }

    try {
        // 1. Verifica se é um Dono de Marca (apenas checando a existência da chave pública)
        console.log('🔍 Verificando se é Dono de Marca...');
        const { data: brandOwner, error: brandOwnerError } = await supabase
            .from('users')
            .select('public_key') // <--- REMOVIDO 'role' daqui
            .eq('public_key', publicKey)
            .single();

        if (brandOwnerError && brandOwnerError.code !== 'PGRST116') {
            console.error('Erro ao buscar dono de marca:', brandOwnerError);
            // Continua a execução, pois pode ser um parceiro
        }

        if (brandOwner) {
            console.log('✅ Encontrado como Dono de Marca');
            return res.status(200).json({
                role: 'batchOwner',
                publicKey: brandOwner.public_key
            });
        }

        // 2. Verifica se é um Parceiro com role específico
        console.log('🔍 Verificando se é Parceiro...');
        const { data: partner, error: partnerError } = await supabase
            .from('partners')
            .select('public_key, role, name, is_active')
            .eq('public_key', publicKey)
            .single();

        if (partnerError && partnerError.code !== 'PGRST116') {
            console.error('Erro ao buscar parceiro:', partnerError);
        }

        if (partner) {
            if (!partner.is_active) {
                console.warn('⚠️ Parceiro encontrado mas inativo:', partner.public_key);
                return res.status(200).json({
                    role: 'noAuth',
                    reason: 'partner_inactive'
                });
            }

            console.log('✅ Encontrado como Parceiro:', partner.role);
            return res.status(200).json({
                role: partner.role,
                publicKey: partner.public_key,
                partnerName: partner.name
            });
        }

        // 3. Se não for encontrado em nenhuma tabela
        console.warn('❌ Chave pública não encontrada em nenhuma tabela:', publicKey);
        return res.status(200).json({
            role: 'noAuth',
            reason: 'not_found'
        });

    } catch (error) {
        console.error('💥 Erro interno ao verificar o papel do usuário:', error);
        return res.status(500).json({
            error: 'Erro interno ao verificar o papel.',
            details: error.message
        });
    }
};

// Nova rota para registro de parceiros
export const registerPartner = async (req, res) => {
    const { publicKey, role, name, email, metadata } = req.body;

    try {
        const { data, error } = await supabase
            .from('partners')
            .insert([
                {
                    public_key: publicKey,
                    role: role,
                    name: name,
                    email: email,
                    metadata: metadata || {},
                    is_active: true,
                    created_at: new Date().toISOString()
                }
            ])
            .select()
            .single();

        if (error) {
            console.error('Erro ao registrar parceiro:', error);
            return res.status(400).json({ error: error.message });
        }

        res.status(201).json({ 
            success: true, 
            partner: data 
        });
    } catch (error) {
        console.error('Erro ao registrar parceiro:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};

