import { Request } from 'express';

// Extend Express Request to include auth properties
declare global {
  namespace Express {
    interface Request {
      user?: any;
      scopes?: string[];
      apiKey?: string;
    }
  }
}

export {};

