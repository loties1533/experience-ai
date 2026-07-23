import 'dotenv/config';

export const CLE_ANTHROPIC  = process.env.ANTHROPIC_API_KEY?.trim() ?? null;
export const CLE_OPENROUTER = process.env.OPENROUTER_API_KEY?.trim() ?? null;
