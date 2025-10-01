import express from 'express';
import multer from 'multer';
import * as batchController from '../controllers/batchController.js';
import * as partnersController from '../controllers/partnersController.js'; 
import * as authController from '../controllers/authController.js';
const router = express.Router();

// Configuração do Multer para upload de arquivos em memória
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- Rotas de Parceiros (Partners) ---

router.post('/partners', partnersController.createPartner);
router.get('/partners', partnersController.getMyPartners);
router.post('/auth/check-role', authController.checkUserRole); 

router.get('/batches/workstation', batchController.getWorkstationBatches);

router.get('/stages/history', batchController.getActorHistory);


// --- Rotas de Lotes (Batches) ---
router.post('/batches', upload.single('attachment'), batchController.createBatch);
router.get('/batches', batchController.getMyBatches);
router.get('/batches/:id', batchController.getBatchDetails);
router.post('/batches/:id/finalize', batchController.finalizeBatch); // ✨ NOVO: Rota para finalizar um lote
router.post('/batches/:id/participants', batchController.addParticipants);
// --- Rota de Etapas (Stages) ---
router.post('/batches/:id/stages', upload.single('attachment'), batchController.addStage);
router.delete('/batches/:batchId/participants/:partnerId', batchController.removeParticipant);
// --- Rota de Transferência de Posse ---
router.post('/batches/:id/transfer', batchController.transferCustody); // ✨ NOVO: Rota para a "corrida de revezamento"



export default router;