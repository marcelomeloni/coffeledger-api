import { supabase } from '../utils/supabase.js';

export const checkUserRole = async (req, res) => {
    const { publicKey } = req.body;

    if (!publicKey) {
        return res.status(400).json({ error: 'A chave pública é obrigatória.' });
    }

    try {
        // 1. Verifica se é um Dono de Marca (sempre o mais alto privilégio)
        const { data: brandOwner } = await supabase
            .from('users')
            .select('public_key')
            .eq('public_key', publicKey)
            .single();

        if (brandOwner) {
            return res.status(200).json({ role: 'batchOwner' });
        }

        // 2. 🔥 MUDANÇA CRÍTICA: Buscar o papel específico do parceiro
        //    Em vez de apenas 'public_key', agora selecionamos também a coluna 'role'.
        const { data: partner } = await supabase
            .from('partners')
            .select('public_key, role') // <-- MUDANÇA AQUI
            .eq('public_key', publicKey)
            .single();
        
        if (partner) {
            // Em vez de retornar 'stagePartner', retornamos o papel real do banco de dados.
            return res.status(200).json({ role: partner.role }); // <-- MUDANÇA AQUI
        }

        // 3. Se não for nenhum dos dois, não tem autorização
        return res.status(200).json({ role: 'noAuth' });

    } catch (error) {
        // Ignora o erro "linha não encontrada" que o .single() pode gerar
        if (error.code === 'PGRST116') {
             return res.status(200).json({ role: 'noAuth' });
        }
        console.error('Erro ao verificar o papel do usuário:', error);
        res.status(500).json({ error: 'Erro interno ao verificar o papel.' });
    }
};
