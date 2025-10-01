// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middlewares
app.use(cors()); // Permite requisições do seu frontend
app.use(express.json()); // Para parsear JSON no corpo das requisições
app.use(express.urlencoded({ extended: true }));

// Rota principal da API
app.use('/api', apiRoutes);

// Rota de health check
app.get('/', (req, res) => {
  res.send('API de Rastreabilidade de Café está no ar! ☕️');
});

app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});