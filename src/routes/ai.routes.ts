import express from 'express';
import { findCandidates, saveSearch, getSuggestions } from '../controllers/ai.controller';

const router = express.Router();

router.post('/find-candidates', findCandidates);
router.post('/save-search', saveSearch);
router.get('/suggestions', getSuggestions);

export default router;
