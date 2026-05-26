export type PartLabel = "A" | "B" | "C";

export interface QuestionPart {
  label: PartLabel;
  prompt: string;
  /** Maximum points this part is worth (1 or 2). */
  maxScore: number;
  /** Internal rubric for the grading API — never exposed in the UI. */
  scoringGuidance: string;
}

export interface QuestionTable {
  title: string;
  columns: [string, string];
  rows: [string, string][];
}

export interface Question {
  id: string;
  dropdownLabel: string;
  standard: string;
  topic: string;
  /**
   * Path relative to /public for a static diagram image.
   * Shown above the stem in the question card.
   */
  imageUrl?: string;
  /**
   * Structured table rendered in place of an image.
   * Used by M2Q15.
   */
  table?: QuestionTable;
  stem: string;
  parts: QuestionPart[];
}

// ─────────────────────────────────────────────────────────────────────────────

export const QUESTIONS: Question[] = [
  // ── M1Q14 ────────────────────────────────────────────────────────────────
  {
    id: "M1Q14",
    dropdownLabel: "M1Q14 – DNA and Protein Structure",
    standard: "3.1.9-12.A",
    topic: "DNA and Protein Structure",
    imageUrl: "/images/M1Q14.png",
    stem: "Amino acids connect in specific sequences to form specialized proteins. The diagrams show the structure of an amino acid and some examples of R side chains.",
    parts: [
      {
        label: "A",
        prompt: "Describe the substance in the cell that determines the order of amino acids in a protein.",
        maxScore: 1,
        scoringGuidance:
          "Award 1 point if the response identifies DNA (or a gene / DNA sequence / mRNA derived from DNA) as the substance that determines the order of amino acids. Accept 'genes' or 'the genetic code' if the meaning is clear.",
      },
      {
        label: "B",
        prompt: "Explain how the order of amino acids affects the structure of a protein.",
        maxScore: 1,
        scoringGuidance:
          "Award 1 point if the response explains that the specific sequence (order) of amino acids determines how the protein folds into its three-dimensional shape/structure. Accept references to interactions between R side chains (hydrogen bonds, ionic bonds, hydrophobic interactions) that drive folding and determine final shape.",
      },
      {
        label: "C",
        prompt: "Explain why having many types of proteins is important for a cell.",
        maxScore: 1,
        scoringGuidance:
          "Award 1 point if the response explains that different proteins perform different functions (e.g., enzymes catalyze reactions, structural proteins provide support, transport proteins move substances, receptor proteins receive signals), so having many types allows the cell to carry out many essential and diverse processes.",
      },
    ],
  },

  // ── M1Q15 ────────────────────────────────────────────────────────────────
  {
    id: "M1Q15",
    dropdownLabel: "M1Q15 – Homeostasis and Feedback Mechanisms",
    standard: "3.1.9-12.C",
    topic: "Homeostasis and Feedback Mechanisms",
    imageUrl: "/images/M1Q15.png",
    stem: "A teacher keeps a classroom dimly lit for a few minutes. Then the teacher turns on a bright light. The drawing shows how one student's eyes changed.",
    parts: [
      {
        label: "A",
        prompt: "Briefly describe why the student's eyes changed.",
        maxScore: 1,
        scoringGuidance:
          "Award 1 point if the response describes that the pupils constricted/became smaller in response to bright light to reduce the amount of light entering the eye (to protect the retina or to prevent too much light). Accept responses mentioning the iris muscles contracting to constrict the pupil.",
      },
      {
        label: "B",
        prompt: "Explain why the teacher had the classroom dimly lit for a few minutes before starting the investigation.",
        maxScore: 1,
        scoringGuidance:
          "Award 1 point if the response explains that dim light allowed the students' pupils to dilate so that all students would have a consistent/standardized starting condition (pupils at maximum or near-maximum dilation) before the investigation began, allowing for a fair/controlled comparison.",
      },
      {
        label: "C",
        prompt: "Describe a feedback mechanism for the pupil of a person's eye if the person were to move from an area with bright light to an area with dim light.",
        maxScore: 1,
        scoringGuidance:
          "Award 1 point if the response correctly describes a negative feedback sequence: moving to dim light is detected → the iris muscles relax → the pupil dilates (gets larger) to allow more light in → this counteracts the decrease in light, helping restore adequate vision. The response must include both the stimulus (dim light) and the compensatory response (pupil dilation).",
      },
    ],
  },

  // ── M2Q14 ────────────────────────────────────────────────────────────────
  {
    id: "M2Q14",
    dropdownLabel: "M2Q14 – Genetics and Heredity",
    standard: "3.1.9-12.P",
    topic: "Genetics and Heredity",
    // No image and no table for this question
    stem: "Bearded dragons are a type of lizard and are popular pets for reptile keepers. Wild bearded dragons tend to be dark in color due to a protein called melanin. However, many color variations exist in the pet trade. Breeders have been able to develop bearded dragons that are bright red, orange, and yellow.",
    parts: [
      {
        label: "A",
        prompt: "Describe how breeders can develop different-colored bearded dragons.",
        maxScore: 1,
        scoringGuidance:
          "Award 1 point if the response describes that breeders select individuals with desired color traits and mate (cross/breed) them together over multiple generations (selective breeding / artificial selection) to increase the frequency of the desired color trait.",
      },
      {
        label: "B",
        prompt: "Describe the role of parental DNA in affecting the colors produced in the offspring.",
        maxScore: 1,
        scoringGuidance:
          "Award 1 point if the response explains that DNA (genes/alleles) from each parent is passed to the offspring, and the combination of alleles inherited from both parents determines the offspring's coloration. Accept responses that mention dominant/recessive alleles, genes for color/melanin production, or that each parent contributes one allele per gene.",
      },
      {
        label: "C",
        prompt: "A particular desired color is a recessive trait. Describe the process a breeder should use to develop the recessive trait in bearded dragons.",
        maxScore: 1,
        scoringGuidance:
          "Award 1 point if the response describes that the breeder must mate two individuals that both carry the recessive allele — either two carriers (heterozygous) or two individuals that already express the recessive trait (homozygous recessive) — to reliably produce offspring showing the recessive color. Accept any response that conveys both parents must contribute the recessive allele.",
      },
    ],
  },

  // ── M2Q15 ────────────────────────────────────────────────────────────────
  {
    id: "M2Q15",
    dropdownLabel: "M2Q15 – Green Stormwater Infrastructure",
    standard: "3.1.9-12.N",
    topic: "Green Stormwater Infrastructure",
    table: {
      title: "Green Stormwater Infrastructure",
      columns: ["System", "Description"],
      rows: [
        [
          "bioswale",
          "a channel filled with vegetation that is designed to transport stormwater away from streets, parking lots, and roofs",
        ],
        [
          "green roof",
          "a layer of plant material that absorbs water on a rooftop",
        ],
        [
          "pervious (permeable) pavement",
          "pavement designed to be infiltrated by rainwater and melting snow",
        ],
        [
          "rain garden",
          "a slight depression in a landscape where water from a roof, driveway, or street can soak into the ground and that can be planted with flowers",
        ],
      ],
    },
    stem: "Water from heavy rainstorms does not soak into ground that is covered in concrete or some other human-made materials. The table lists some examples of landscaping solutions that address the collection of stormwater. Solutions that are considered environmentally friendly are called \"green.\"",
    parts: [
      {
        label: "A",
        prompt: "Describe a likely way that adding green stormwater infrastructure to a community would benefit the local ecosystem.",
        maxScore: 1,
        scoringGuidance:
          "Award 1 point if the response describes a clear ecosystem benefit connected to GSI, such as: reduced water pollution/improved water quality in local streams or groundwater; reduced erosion and sediment runoff; reduced flooding that could harm habitats; increased biodiversity by providing habitat; or groundwater recharge that supports wetlands or riparian ecosystems.",
      },
      {
        label: "B",
        prompt: "Describe two ways that researchers could measure the effectiveness of green stormwater infrastructure.",
        maxScore: 2,
        scoringGuidance:
          "Award 1 point per valid measurement method described, up to 2 points maximum. Accept any two of: (1) measuring pollutant or nutrient concentrations (e.g., nitrogen, phosphorus, heavy metals) in runoff before and after GSI installation; (2) measuring total stormwater volume or flow rate; (3) comparing frequency or severity of local flooding events; (4) measuring turbidity or sediment levels in nearby waterways; (5) surveying local species biodiversity before and after installation; (6) monitoring groundwater levels; (7) measuring soil infiltration/absorption rates. Each method must be described clearly enough to be scientifically meaningful.",
      },
    ],
  },
];

export const QUESTION_MAP: Record<string, Question> = Object.fromEntries(
  QUESTIONS.map((q) => [q.id, q])
);
