import { Router } from 'express';
import * as AiController from '../controllers/AiController';

const AiRoutes = Router();

AiRoutes.get('/', (req, res) => {
  res.status(200).json({ message: '👋 Welcome to the Gemini AI API!' });
});

AiRoutes.post('/test', AiController.AiTest);

AiRoutes.post('/jobs', )

export default AiRoutes;
