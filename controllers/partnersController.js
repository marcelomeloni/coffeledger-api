import { supabase } from '../utils/supabase.js';

// POST /api/partners - Criar um novo parceiro
export const createPartner = async (req, res) => {
    // ✨ CORREÇÃO: Recebe a chave do Dono da Marca diretamente da requisição
    const { brandOwnerKey, publicKey, name, role, contactEmail } = req.body;

    if (!brandOwnerKey || !publicKey || !name || !role) {
        return res.status(400).json({ error: 'brandOwnerKey, publicKey, name, e role são obrigatórios.' });
    }

    const { data, error } = await supabase
        .from('partners')
        .insert([{ 
            brand_owner_key: brandOwnerKey, 
            public_key: publicKey, 
            name, 
            role, 
            contact_email: contactEmail,
            metadata: {} 
        }])
        .select()
        .single();
    
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
};

// GET /api/partners - Listar parceiros do Dono da Marca
export const getMyPartners = async (req, res) => {
    // ✨ CORREÇÃO: Recebe a chave do Dono da Marca dos query params
    const brandOwnerKey = req.query.owner;

    if (!brandOwnerKey) {
        return res.status(400).json({ error: 'O parâmetro de query "owner" é obrigatório.' });
    }

    const { data, error } = await supabase
        .from('partners')
        .select('*')
        .eq('brand_owner_key', brandOwnerKey);

    if (error) return res.status(400).json({ error: error.message });
    res.status(200).json(data);
};
// GET /api/partners/:id - Buscar dados de um único parceiro
export const getPartnerProfile = async (req, res) => {
    console.log('API: GET /partners/:id - Recebida solicitação para buscar perfil de parceiro.');
    const { id: partnerId } = req.params;

    if (!partnerId) {
        console.warn('API: Erro 400 - ID do parceiro faltando.');
        return res.status(400).json({ error: 'O ID do parceiro é obrigatório.' });
    }

    try {
        console.log(`API: Buscando perfil para o partnerId: ${partnerId}`);
        const { data, error } = await supabase
            .from('partners')
            .select('*')
            .eq('id', partnerId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') { // Não encontrado
                console.warn(`API: Parceiro não encontrado com ID: ${partnerId}`);
                return res.status(404).json({ error: 'Parceiro não encontrado.' });
            }
            console.error('API: Erro ao buscar perfil no Supabase:', error);
            return res.status(400).json({ error: error.message });
        }
        
        console.log('API: ✅ Perfil de parceiro encontrado com sucesso.');
        res.status(200).json(data);
    } catch (err) {
        console.error('API: Erro interno no getPartnerProfile:', err);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
};

// PATCH /api/partners/:id/metadata - Atualizar o campo metadata do parceiro
export const updatePartnerMetadata = async (req, res) => {
    console.log('API: PATCH /partners/:id/metadata - Recebida solicitação de atualização de metadados.');
    const { id: partnerId } = req.params;
    const { metadata } = req.body;
    
    if (!partnerId || !metadata) {
        console.warn('API: Erro 400 - ID ou metadados faltando.');
        return res.status(400).json({ error: 'ID do parceiro e metadados são obrigatórios.' });
    }

    try {
        console.log(`API: Tentando atualizar metadados para o partnerId: ${partnerId}`);
        const { data, error } = await supabase
            .from('partners')
            .update({ metadata: metadata })
            .eq('id', partnerId)
            .select()
            .single();

        if (error) {
            console.error('API: Erro ao atualizar metadados no Supabase:', error);
            return res.status(400).json({ error: error.message });
        }

        console.log('API: ✅ Metadados atualizados com sucesso.');
        res.status(200).json(data);
    } catch (err) {
        console.error('API: Erro interno no updatePartnerMetadata:', err);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
};