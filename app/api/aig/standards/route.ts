import { NextResponse } from "next/server";
import { getStandards } from "@/lib/aig/data";

export async function GET() {
  const standards = getStandards().map(({ standard, kcs, module, strand, statement }) => ({
    standard,
    kcCount: kcs.length,
    module,
    strand,
    statement,
  }));
  return NextResponse.json({ standards });
}
