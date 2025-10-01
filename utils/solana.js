// utils/solana.js
import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@project-serum/anchor';
import { mnemonicToSeedSync } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import idl from '../idl.json' with { type: 'json' };
import dotenv from 'dotenv';
dotenv.config();

const PROGRAM_ID = 'FmdwhFLmtZmHvMu8rpCv2tmURGhmZvxtZcEDQXN5Si74';

// Carrega a carteira facilitadora a partir da frase secreta no .env
const getPayerWallet = () => {
    const seed = mnemonicToSeedSync(process.env.SECRET_RECOVERY_PHRASE);
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
    const keypair = Keypair.fromSeed(derivedSeed);
    return new Wallet(keypair);
};

// Configura a conexão e o provedor Anchor
const connection = new Connection(process.env.SOLANA_RPC_ENDPOINT, 'confirmed');
const wallet = getPayerWallet();
const provider = new AnchorProvider(connection, wallet, {
    preflightCommitment: 'confirmed',
    commitment: 'confirmed',
});

// Inicializa o programa
const program = new Program(idl, PROGRAM_ID, provider);

export { program, provider, wallet, connection };