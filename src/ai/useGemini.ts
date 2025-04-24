import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

const apikey = process.env.GEMINI_API_KEY;

class UseGeminiAi {
  private genAi: GoogleGenerativeAI;
  private model: GenerativeModel;

  constructor() {
    if (!apikey) {
      throw new Error('GEMINI_API_KEY is not defined in environment variables.');
    }

    this.genAi = new GoogleGenerativeAI(apikey);
    this.model = this.genAi.getGenerativeModel({ model: 'models/gemini-1.5-pro' });

    console.log('Gemini AI initialized');
  }

  async analyze(prompt: string): Promise<string> {
    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (err) {
      console.error('Error generating content:', err);
      return 'Error generating response.';
    }
  }

  async devErrorFix(error:any){
      try {
        
        const fix = await this.model.generateContent(`fix this express ts api development error: ${error}`)

        const response = await fix.response

        return response.text()

      } catch (error) {
        console.error(error)
        return error
      }
  }

  async AnalyseAndFilterDataSet(passedprompt: string, dataset: any) {
    try {
      const prompt = `
  You are a data filtering AI. Given the following prompt and dataset, analyze the dataset and return a JSON object with the SAME STRUCTURE but updated according to the instructions in the prompt.
  
  Prompt: ${passedprompt}
  
  Dataset:
  ${JSON.stringify(dataset, null, 2)}
  
  Return ONLY the updated dataset as valid JSON.
      `.trim();
  
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const rawText = response.text();
  
      // Try to parse the JSON from Gemini response
      const match = rawText.match(/```json([\s\S]*?)```/);
      const jsonText = match ? match[1].trim() : rawText;
  
      try {
        const filteredData = JSON.parse(jsonText);
        return filteredData;
      } catch (parseErr) {
        console.warn('Could not parse JSON directly, returning raw text.');
        return jsonText;
      }
  
    } catch (error) {
      console.error('Error analyzing dataset:', error);
      return { error: 'Failed to analyze dataset.' };
    }
  }
  


}

export const useGemini = new UseGeminiAi();
