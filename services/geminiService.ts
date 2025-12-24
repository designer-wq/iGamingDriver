import { GoogleGenAI } from "@google/genai";

let ai: GoogleGenAI | null = null;

const getAIClient = () => {
    if (!ai) {
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
            console.warn("API Key not found, AI features will be disabled.");
            return null;
        }
        ai = new GoogleGenAI({ apiKey });
    }
    return ai;
};

export const searchProviderInfo = async (query: string) => {
    const client = getAIClient();
    if (!client) return { text: "Erro: Chave de API não configurada.", sources: [] };

    try {
        const response = await client.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: query,
            config: {
                tools: [{ googleSearch: {} }],
            },
        });

        const text = response.text || "Não foi possível encontrar informações.";

        // Extract grounding metadata safely
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const sources = groundingChunks
            .filter((chunk: any) => chunk.web?.uri && chunk.web?.title)
            .map((chunk: any) => ({
                title: chunk.web.title,
                uri: chunk.web.uri
            }));

        return { text, sources };
    } catch (error) {
        console.error("Gemini API Error:", error);
        return { text: "Desculpe, ocorreu um erro ao buscar as informações. Tente novamente mais tarde.", sources: [] };
    }
};
