// Purpose: Researches a stock from macro, sector, and company angles before synthesizing the findings.

import {
  agent,
  phase,
  defineWorkflow,
  Effect,
  parallel,
  Schema,
  textPrompt,
} from "@openchart/workflow";

/** Arguments validated by this file before execution. */
const multiAngleResearchArgs = Schema.Struct({
  question: Schema.String.check(Schema.isPattern(/\S/)),
});

const angles = [
  {
    name: "macro",
    focus:
      "Analyze the macroeconomic environment relevant to this stock: growth, inflation, interest rates, liquidity, currencies, policy, and geopolitical conditions where material. Explain how these factors affect the company's demand, costs, financing, and valuation.",
  },
  {
    name: "sector",
    focus:
      "Analyze the relevant sector and industry: demand and supply, cycle position, structural trends, competition, regulation, and peer performance or valuation where useful. Explain the company's positioning and which industry forces create opportunities or risks.",
  },
  {
    name: "company",
    focus:
      "Analyze the company itself: business model, competitive advantages, financial performance, cash flow, balance sheet, management, capital allocation, valuation, and upcoming catalysts. Identify the main drivers of the investment thesis and what could invalidate it.",
  },
] as const;

/** Three independent research Sessions followed by a summarizer, all using the kickoff model. */
export default defineWorkflow({
  description:
    "Accepts {question: string}, a stock name or ticker with optional research questions, horizon, and constraints. Researches macro, sector, and company perspectives in parallel, then synthesizes them. All four agents use the parent prompt model.",
  args: multiAngleResearchArgs,
  run: (args, { parentPrompt }) =>
    Effect.gen(function* () {
      const outcomes = yield* phase(
        "Research angles",
        parallel(
          angles.map(({ name, focus }) =>
            agent(
              textPrompt(
                [
                  `Research angle: ${name}. Independently investigate the stock in the user's request.`,
                  `Research request: ${args.question}`,
                  focus,
                  "Respect the user's scope, time horizon, and language. State the company and listing you analyze and any necessary assumptions; do not silently substitute another security. Focus on material factors rather than forcing every topic into the report.",
                  "Use available research tools to verify time-sensitive claims, prefer primary sources, and cite source links with relevant dates and reporting periods. Distinguish verified facts, interpretations, and scenarios. Do not invent figures or sources; state when evidence is unavailable or stale.",
                  "Return a focused research brief with key findings, supporting evidence, upside and downside drivers, uncertainties, and conditions that would change your assessment.",
                ].join("\n\n"),
                parentPrompt.model,
                parentPrompt.agent,
              ),
              { label: name },
            ),
          ),
        ),
      );
      const research = outcomes.map((outcome, index) => ({
        angle: angles[index]!.name,
        ...outcome,
      }));
      const summary = yield* phase(
        "Synthesis",
        agent(
          textPrompt(
            [
              "Synthesize the macro, sector, and company research into one coherent stock assessment as a neutral analyst.",
              `Research request: ${args.question}`,
              "Respect the user's scope, time horizon, and language. Check that the briefs concern the same company, listing, and comparable periods. Explain how macro conditions, industry dynamics, and company fundamentals interact; resolve conflicting evidence where possible and retain unresolved disagreements.",
              "Lead with the overall assessment, then explain its strongest evidence, key risks and catalysts, relevant upside and downside scenarios, and what would change the conclusion. Preserve useful source links and dates. Distinguish verified facts from assumptions and unverified claims; repeated claims across briefs are not independent corroboration.",
              "Explicitly identify failed or missing research angles and the resulting limits. If evidence is insufficient, say so instead of inventing a conclusion. Use available research tools to verify material gaps or contradictions when needed.",
              `Research outcomes:\n${JSON.stringify(research)}`,
            ].join("\n\n"),
            parentPrompt.model,
            parentPrompt.agent,
          ),
          { label: "summarizer" },
        ),
      );
      return { question: args.question, research, summary };
    }),
});
