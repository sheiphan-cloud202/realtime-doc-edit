import OpenAI from 'openai';
import { AIRequest } from '../../../shared/types';

export interface AIServiceConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  requestTimeoutMs?: number;
  enableStreaming?: boolean;
}

export interface AIProcessingResult {
  success: boolean;
  result?: string;
  error?: string;
  retryCount: number;
}

/**
 * AIServiceAdapter handles integration with OpenAI API for text processing
 * Includes retry logic with exponential backoff and proper error handling
 */
export class AIServiceAdapter {
  private openai: OpenAI;
  private config: Required<AIServiceConfig>;

  constructor(config: AIServiceConfig) {
    this.config = {
      model: 'gpt-3.5-turbo',
      maxTokens: 1000,
      temperature: 0.7,
      maxRetries: 3,
      retryDelayMs: 1000,
      requestTimeoutMs: 45000, // 45 seconds
      enableStreaming: false,
      ...config
    };

    this.openai = new OpenAI({
      apiKey: this.config.apiKey,
      timeout: this.config.requestTimeoutMs,
    });
  }

  /**
   * Process an AI request with retry logic and error handling
   */
  async processRequest(request: AIRequest): Promise<AIProcessingResult> {
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount <= this.config.maxRetries) {
      try {
        const result = await this.makeAIRequest(request);
        return {
          success: true,
          result,
          retryCount
        };
      } catch (error) {
        lastError = error as Error;
        retryCount++;

        if (retryCount <= this.config.maxRetries) {
          const delay = this.calculateRetryDelay(retryCount);
          await this.sleep(delay);
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error occurred',
      retryCount
    };
  }

  /**
   * Make the actual API request to OpenAI
   */
  private async makeAIRequest(request: AIRequest): Promise<string> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(request);

    try {
      console.log(`Making AI request for ${request.id} with timeout ${this.config.requestTimeoutMs}ms`);
      
      // For now, disable streaming to avoid TypeScript complexity
      const completion = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        stream: false, // Disable streaming for now
      });

      if (!completion || !completion.choices || completion.choices.length === 0) {
        throw new Error('No choices returned from AI service');
      }

      const result = completion.choices[0]?.message?.content;
      if (!result) {
        throw new Error('No content returned from AI service');
      }

      console.log(`AI request ${request.id} completed successfully`);
      return result.trim();
    } catch (error) {
      console.error(`AI request ${request.id} failed:`, error);
      
      // Provide more specific error messages
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new Error(`AI service timeout after ${this.config.requestTimeoutMs}ms`);
        }
        if (error.message.includes('rate limit')) {
          throw new Error('AI service rate limit exceeded');
        }
        if (error.message.includes('Cannot read properties')) {
          throw new Error('Invalid response format from AI service');
        }
        if (error.message.includes('API key')) {
          throw new Error('Invalid API key for AI service');
        }
      }
      
      throw error;
    }
  }

  /**
   * Build system prompt for AI requests
   */
  private buildSystemPrompt(): string {
    return `You are an AI assistant helping users edit documents. 
You will be given a selected portion of text and a user prompt describing how to modify it.
Your task is to return ONLY the modified text that should replace the selected portion.
Do not include explanations, formatting, or any additional text beyond the replacement content.
Maintain the original style and tone unless specifically asked to change it.`;
  }

  /**
   * Build user prompt combining selected text and user instruction
   */
  private buildUserPrompt(request: AIRequest): string {
    return `Selected text: "${request.selectedText}"

User instruction: ${request.prompt}

Please provide the modified text:`;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateRetryDelay(retryCount: number): number {
    return this.config.retryDelayMs * Math.pow(2, retryCount - 1);
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate AI request before processing
   */
  validateRequest(request: AIRequest): { valid: boolean; error?: string } {
    if (!request.selectedText || request.selectedText.trim().length === 0) {
      return { valid: false, error: 'Selected text cannot be empty' };
    }

    if (!request.prompt || request.prompt.trim().length === 0) {
      return { valid: false, error: 'Prompt cannot be empty' };
    }

    if (request.selectedText.length > 10000) {
      return { valid: false, error: 'Selected text too long (max 10000 characters)' };
    }

    if (request.prompt.length > 1000) {
      return { valid: false, error: 'Prompt too long (max 1000 characters)' };
    }

    return { valid: true };
  }

  /**
   * Get service health status
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      // Make a simple test request to verify API connectivity
      await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
      });
      return { healthy: true };
    } catch (error) {
      return { 
        healthy: false, 
        error: (error as Error).message 
      };
    }
  }
}