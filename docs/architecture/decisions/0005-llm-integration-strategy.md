# ADR-0005: LLM Integration Strategy

## Status
Accepted

## Date
2026-01-31

## Context
PubliMentor uses LLMs for several features:
- Reviewer suggestion (primary source for candidate names)
- Manuscript metadata extraction (title, authors, abstract)
- Document summarization and analysis
- Future: RAG-based manuscript Q&A

## Decision
We will use a multi-provider LLM strategy:
1. **Claude (Anthropic)**: Primary LLM for complex reasoning tasks
2. **Hugging Face Inference API**: Open-source embeddings (sentence-transformers)
3. **Abstraction layer**: Provider-agnostic interface for easy switching

## Consequences

### Positive
- **Best-in-class reasoning**: Claude excels at structured extraction
- **Cost optimization**: Use cheaper models for simpler tasks
- **Open-source embeddings**: No vendor lock-in for vectors
- **Flexibility**: Can switch providers based on cost/performance

### Negative
- **Multiple API keys**: More secrets to manage
- **Latency variability**: Different providers have different response times
- **Cost unpredictability**: Usage-based pricing can spike

### Risks
- **API rate limits**: Heavy usage may hit limits; mitigated by queuing, caching
- **Model changes**: Provider model updates may affect output; mitigated by versioning prompts
- **Data privacy**: Manuscript content sent to external APIs; mitigated by data processing agreements

## Implementation Pattern

```typescript
// Abstraction for provider switching
interface LLMProvider {
  complete(prompt: string, options: LLMOptions): Promise<string>;
  extractStructured<T>(prompt: string, schema: z.ZodType<T>): Promise<T>;
}

// Usage in services
const reviewerSuggestions = await llm.extractStructured(
  buildReviewerPrompt(manuscript),
  ReviewerSuggestionSchema
);
```

## Alternatives Considered

### Option A: OpenAI Only
- **Pros**: Single provider, extensive documentation
- **Cons**: Higher costs, less control, data privacy concerns

### Option B: Self-hosted LLMs (Ollama/vLLM)
- **Pros**: Full data privacy, no API costs
- **Cons**: GPU infrastructure costs, model quality trade-offs, maintenance burden

### Option C: AWS Bedrock
- **Pros**: Enterprise compliance, multiple models
- **Cons**: AWS lock-in, complex pricing, latency

## References
- [Anthropic Claude Documentation](https://docs.anthropic.com/)
- [Hugging Face Inference API](https://huggingface.co/docs/api-inference/)
- [LLM Prompt Engineering Guide](https://www.promptingguide.ai/)
