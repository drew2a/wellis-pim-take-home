# Agent notes

How I directed this work through Claude Code. The unedited session traces are the full record. This is the short version.

## How I split it

Docs before code. `REQUIREMENTS.md`, `QUESTIONS.md`, `CLAUDE.md` and the ADR log came first. Every later session started from the same definition of "correct". I used one topic branch per block: profile the export, agree the mapping, scaffold, schema, importer load, eligibility, detectors, report, intake, console. I used eight small fix branches once I started using the application. Each block of the build ended with a review in a fresh session before the merge, and with an ADR for whatever it decided. The agent drafted each ADR as `proposed`. Accepting it was my job, in my own commit. An agent commit flipped a status once. I reverted it and reopened the ADR.

## Where I let it run, where I took the wheel

I let it run when invariants already answered the question. This included profiling the export (36 inventories from a spec I provided), mapping ordinary columns, the report, and most of the UI. From the sixth branch on, I stopped approving plans. I let it work directly from the files.

I took the wheel for every column carrying identity, medicine or consent. This meant `legacy_patient_id` and the orphans, `meds_current`, `conditions`, `outcome`, the consent log, and the duplicate tiers. I read the facts and wrote those decisions myself.

I stopped it twice. Once, it launched a subagent before I accepted the plan. Once, it tried to process `intakes.csv` past the columns I wanted.

## What went wrong, and what caught it

- **My own phrasing.** Mid-discussion I said "for mapping there should not be any rules". I meant "the importer is not a rule engine". Read literally, it would have dropped the normalisation records. It asked instead of rewriting. This saved it. Terse corrections get read literally.
- **Plausible but wrong claims.** It told me the weight-divergence detector already covered the five patients whose signup weight is 6.5–8.6 kg. It covers three of them, and for the wrong reason. That detector asks whether a patient's signup weight disagrees with their own intake weights. These patients' intakes carry the same impossible order of magnitude. Two of the five agree with themselves and pass in silence. Even for the three it catches, the item reads "these two numbers disagree — which is right?". Neither is right. An adult cannot weigh 7 kg. A separate plausibility detector with bounds in `rules/v1.json` asks that question instead. The claim was close enough to true to pass a reading. I now check claims against the data rather than against how confident the agent sounds.
- **Reviews beat agreement.** The fresh-session reviews found the contradiction between append-only evidence and importer idempotency (ADR-0008). They found an alias bug relying on `RETURNING` order. They found a float BMI wrong exactly at the band boundary. They found a missing input silently becoming `auto_cleared`. None of that came out of agreeing lines with the agent.
- **Using the thing.** Three defects came from clicking through the running app. No test caught them. A page did the right thing twice, or said the wrong sentence about it. Using the app also corrected a decision of mine. I put `auto_cleared` behind a filter. I submitted an intake and could not find it. The brief calls that outcome "clear for doctor review". It is the inbox, not a finished state.
- **Scope it did not need.** It gave reviewers `doctor` and `ops` roles. I accepted this before cutting it. The brief asks for an actor on every decision, not an authorisation model. A second role makes every screen answer "who may do this".

## What I would do differently

I spent attention in the right places. I designed the approach and the schema. I agreed the mapping column by column. I would do all three again. The column loop especially. I looked at the data myself and built the reading that drove every later decision. Handing that over would have left me approving a system I did not understand.

I got the next phase wrong. By the end of the schema branch, everything defining "correct" was in files: `CLAUDE.md`, the ADRs, the schema, `rules/v1.json`. I went on supervising intermediate steps anyway. I approved plans, agreed on sequencing, and reviewed checkpoints the agent did not need to ask for. I changed that on the sixth branch. It belonged two branches earlier. An agent should own those middle steps end to end.

The review can go too. Every real defect of this week came from a review, and an agent ran every one of those reviews in a fresh session. That is why they worked: a session with no memory of writing the code has nothing to defend. What does not delegate is narrower than I assumed. Deciding what "correct" means, before the work starts. And noticing at the end that a working system is wrong for the person using it — the three defects no test caught came from clicking through the app, not from reading its code.
