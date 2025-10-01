// services/ipfsService.js
import pinataSDK from '@pinata/sdk';
import { Readable } from 'stream';
import dotenv from 'dotenv';
dotenv.config();

// Validação das chaves do Pinata no .env
const pinataApiKey = process.env.PINATA_API_KEY;
const pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY;

if (!pinataApiKey || !pinataSecretApiKey) {
    throw new Error('As chaves de API do Pinata são necessárias no arquivo .env');
}

// Inicializa o cliente do Pinata
const pinata = new pinataSDK(pinataApiKey, pinataSecretApiKey);

/**
 * Faz o upload de um objeto JSON para o IPFS via Pinata.
 * @param {object} data - O objeto JSON para fazer upload.
 * @returns {Promise<string>} - O CID (IpfsHash) do arquivo JSON.
 */
export const uploadJson = async (data) => {
    try {
        console.log('Uploading JSON to Pinata...');
        const result = await pinata.pinJSONToIPFS(data, {
            pinataMetadata: {
                name: `Metadata-${Date.now()}.json`,
            },
        });
        console.log('Stored JSON with CID:', result.IpfsHash);
        return result.IpfsHash;
    } catch (error) {
        console.error('Erro ao fazer upload do JSON para o Pinata:', error);
        throw new Error('Falha no upload do metadado JSON.');
    }
};

/**
 * Faz o upload de um arquivo para o IPFS via Pinata.
 * @param {object} file - O objeto de arquivo do multer (req.file).
 * @returns {Promise<string>} - A URL do arquivo no gateway do Pinata.
 */
export const uploadFile = async (file) => {
    try {
        console.log(`Uploading ${file.originalname} to Pinata...`);

        // Converte o buffer do arquivo (da memória) em um stream legível
        const stream = Readable.from(file.buffer);

        // Adiciona o nome do arquivo ao stream para o SDK do Pinata
        stream.path = file.originalname;

        const result = await pinata.pinFileToIPFS(stream, {
            pinataMetadata: {
                name: file.originalname,
            },
        });

        console.log('Stored file with CID:', result.IpfsHash);
        
        // Retorna a URL do gateway público do Pinata
        return `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}`;
    } catch (error) {
        console.error('Erro ao fazer upload do arquivo para o Pinata:', error);
        throw new Error('Falha no upload do arquivo.');
    }
};