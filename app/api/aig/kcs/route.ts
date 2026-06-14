import { NextResponse } from "next/server";
import { getKCs } from "@/lib/aig/data";

export async function GET() {
  const kcs = getKCs().map((kc) => ({
    code: kc.code,
    statement: kc.statement,
    standard: kc.standard,
    module: kc.module,
    unit: kc.unit,
  }));
  return NextResponse.json({ kcs });
}
