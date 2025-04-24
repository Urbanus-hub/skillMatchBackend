import { Request, Response } from 'express';
import { useGemini } from '../ai';
import * as jobsController from '../controllers/job.controller'
export const AiTest = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ message: 'Invalid prompt input.' });
    }

    const response = await useGemini.analyze(prompt);

    return res.status(200).json({ response });
  } catch (error) {
    console.error(' AI Test Error:', error);
    return res.status(500).json({ message: 'Error encountered' });
  }
};

export const filterjobsByPrompt = async(req:Request, res:Response)=>{
  try {
    
    const { prompt} = req.body

    // const listAlljobs = await jobsController.

  } catch (error) {
    
  }
}