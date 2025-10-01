import { supabase } from '../utils/supabase.js';

/**
 * POST /api/auth/check-role
 * Recebe uma chave pública e retorna o papel do usuário no sistema.
 */
export const checkUserRole = async (req, res) => {
    const { publicKey } = req.body;

    if (!publicKey) {
        return res.status(400).json({ error: 'A chave pública é obrigatória.' });
    }

    try {
        // 1. Verifica se é um Dono de Marca (na tabela 'users')
        const { data: brandOwner, error: ownerError } = await supabase
            .from('users')
            .select('public_key')
            .eq('public_key', publicKey)
            .single();

        if (ownerError && ownerError.code !== 'PGRST116') { // Ignora o erro "linha não encontrada"
            throw ownerError;
        }

        if (brandOwner) {
            return res.status(200).json({ role: 'batchOwner' });
        }

        // ✨ CORREÇÃO: A lógica de verificação de parceiros foi simplificada e corrigida.
        // 2. Se não for Dono, verifica se é um Parceiro (na tabela 'partners')
        // Em vez de contar, apenas tentamos buscar um único registro. É mais simples e direto.
        const { data: partner, error: partnerError } = await supabase
            .from('partners')
            .select('public_key')
            .eq('public_key', publicKey)
            .limit(1) // Pega no máximo 1 linha
            .single(); // Retorna o objeto diretamente, ou null se não encontrar

        if (partnerError && partnerError.code !== 'PGRST116') {
            throw partnerError;
        }
        
        // Se 'partner' não for nulo, significa que um registro foi encontrado.
        if (partner) {
            return res.status(200).json({ role: 'stagePartner' });
        }

        // 3. Se não for nenhum dos dois, não tem autorização
        return res.status(200).json({ role: 'noAuth' });

    } catch (error) {
        console.error('Erro ao verificar o papel do usuário:', error);
        res.status(500).json({ error: 'Erro interno ao verificar o papel.' });
    }
};