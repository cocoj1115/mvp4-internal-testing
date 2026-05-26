/**
 * POST /api/parse
 *
 * Accepts a multipart/form-data upload containing a single PDF file
 * (KD1 + KD2 + KE scoring materials).
 *
 * Returns a text/plain streaming response. Each line is either:
 *   - A human-readable progress message
 *   - A final DATA:<json> line carrying the ParseResult payload
 *
 * In production this route should call a document-extraction service
 * (e.g. LlamaParse, AWS Textract, or a custom pipeline) on the uploaded
 * PDF and populate the G0 config from the real extracted content.
 * The simulated delays and placeholder G0 below stand in for that work.
 */

import { NextRequest } from "next/server";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  // Consume the multipart body so the connection doesn't hang.
  try {
    await req.formData();
  } catch {
    // Non-critical — proceed even if parsing fails (e.g. in tests)
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: string) =>
        controller.enqueue(encoder.encode(line + "\n"));

      send("Parsing PDF...");
      await wait(700);
      send("Extracting STEELS standards (KD1)...");
      await wait(900);
      send("Extracting rubric criteria (KD2)...");
      await wait(800);
      send("Extracting scored examples (KE)...");
      await wait(1000);

      const kd1Chunks = 5;
      const kd2Chunks = 3;
      const keExamples = 4;

      send(
        `Done. Found ${kd1Chunks} KD1 chunks, ${kd2Chunks} KD2 chunks, ${keExamples} KE examples.`
      );

      // ── Simulated G0 config ──────────────────────────────────────────────
      // Replace with real extracted content in production.
      const g0 = {
        A: {
          keyConcepts: [
            "Standard 3.1.9-12 (Biology) — Life Sciences",
            "",
            "Key Concepts (KD1):",
            "• DNA contains the genetic instructions for making proteins",
            "• The nucleotide base sequence in DNA (the genetic code) specifies the amino acid sequence of a protein",
            "• Gene expression pathway: DNA → mRNA (transcription) → protein (translation)",
            "• Each mRNA codon specifies a particular amino acid via the genetic code",
          ].join("\n"),

          rubric: [
            "Scoring Criteria — Part A (1 point)",
            "",
            "Award 1 point if the student correctly identifies DNA (or a gene /",
            "gene sequence / mRNA derived from DNA) as the substance that determines",
            "the order of amino acids in a protein.",
            "",
            "Acceptable responses:",
            "• DNA",
            "• Genes / genetic code",
            "• mRNA (only if the student explicitly links it back to DNA)",
            "",
            "Do NOT award the point for:",
            "• Ribosomes (site of translation, not the instruction source)",
            "• Amino acids themselves",
            "• Vague answers such as 'the cell' or 'genetics'",
          ].join("\n"),

          examples: [
            "Scored Example 1 — Score: 1",
            '"DNA contains the instructions for the order of amino acids in a protein through the genetic code."',
            "",
            "Scored Example 2 — Score: 1",
            '"The gene (a section of DNA) encodes the specific sequence of amino acids."',
            "",
            "Scored Example 3 — Score: 0",
            '"Ribosomes determine the order of amino acids when making proteins."',
            "",
            "Scored Example 4 — Score: 0",
            '"The nucleus controls what proteins are made."',
          ].join("\n"),
        },

        B: {
          keyConcepts: [
            "Key Concepts (KD1):",
            "• Protein structure levels: primary (amino acid sequence) → secondary",
            "  (alpha-helix / beta-sheet) → tertiary (3-D fold) → quaternary",
            "• R-side chains interact via hydrogen bonds, hydrophobic forces, ionic",
            "  bonds, and disulfide bridges — these interactions drive folding",
            "• A protein's function depends entirely on its 3-D shape",
          ].join("\n"),

          rubric: [
            "Scoring Criteria — Part B (1 point)",
            "",
            "Award 1 point if the student explains that the amino acid sequence",
            "determines how the protein folds into its 3-D structure, which in turn",
            "determines its function.",
            "",
            "Acceptable responses:",
            "• References to amino acid sequence controlling 3-D shape / folding",
            "• Mention of R-group interactions (hydrogen bonds, hydrophobic forces)",
            "• Statement that structure determines function",
            "",
            "Do NOT award the point for:",
            "• 'The protein will be different' (no structural mechanism given)",
            "• Responses about function only, with no link to structure",
          ].join("\n"),

          examples: [
            "Scored Example 1 — Score: 1",
            '"The order of amino acids determines how the protein folds into its specific 3-D shape, which is necessary for the protein to function correctly."',
            "",
            "Scored Example 2 — Score: 1",
            '"R-side chains of adjacent amino acids interact, causing folding. A different sequence means different interactions and a different shape."',
            "",
            "Scored Example 3 — Score: 0",
            '"The order of amino acids makes the protein different."',
            "",
            "Scored Example 4 — Score: 0",
            '"Amino acids connect to form the protein\'s primary structure."',
          ].join("\n"),
        },

        C: {
          keyConcepts: [
            "Key Concepts (KD1):",
            "• Cells require many different proteins to carry out diverse life functions",
            "• Enzymes (proteins) catalyze specific metabolic reactions",
            "• Structural proteins provide cellular support",
            "• Transport proteins move substances across membranes",
            "• Receptor proteins receive and transmit signals",
            "• Each protein's unique amino acid sequence gives it a specific function",
          ].join("\n"),

          rubric: [
            "Scoring Criteria — Part C (1 point)",
            "",
            "Award 1 point if the student explains that different proteins carry out",
            "different functions, and therefore having many types allows the cell to",
            "perform many essential and diverse biological processes.",
            "",
            "Acceptable responses:",
            "• Cell needs many types for many functions (enzymes, structural,",
            "  transport, signaling, etc.)",
            "• Specialization — each protein does a specific job",
            "• Without variety, the cell could not carry out all needed processes",
            "",
            "Do NOT award the point for:",
            "• 'Cells need proteins to survive' (no mention of diversity/function)",
            "• Only naming one protein function",
          ].join("\n"),

          examples: [
            "Scored Example 1 — Score: 1",
            '"Different proteins perform different functions — enzymes speed up reactions, structural proteins provide support, and transport proteins move substances. A cell needs many types to carry out all of its functions."',
            "",
            "Scored Example 2 — Score: 1",
            '"Each protein has a specific shape for a specific job. Many types means the cell can do many different things."',
            "",
            "Scored Example 3 — Score: 0",
            '"Proteins are important for cells to survive."',
            "",
            "Scored Example 4 — Score: 0",
            '"Having many proteins helps the cell."',
          ].join("\n"),
        },
      };

      const payload = { kd1Chunks, kd2Chunks, keExamples, g0 };
      send(`DATA:${JSON.stringify(payload)}`);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
