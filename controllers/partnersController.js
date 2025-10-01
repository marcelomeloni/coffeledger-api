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
            contact_email: contactEmail 
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