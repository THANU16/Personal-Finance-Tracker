import { describe, expect, it } from "vitest";
import { bpToCsv, csvCell, detectDelimiter, minorToCsv, parseCsv, toCsv } from "@/domain/csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, delimiters and line breaks inside quotes, CRLF and BOM", () => {
    const text =
      '\uFEFFDate,Description,Amount\r\n2026-01-02,"Shop, ""Main""\nBranch",-1500.00\r\n\r\n2026-01-03,Salary,"100,000.00"\n';
    expect(parseCsv(text)).toEqual([
      ["Date", "Description", "Amount"],
      ["2026-01-02", 'Shop, "Main"\nBranch', "-1500.00"],
      ["2026-01-03", "Salary", "100,000.00"],
    ]);
  });

  it("detects ; and tab delimiters", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter('"a;b",c,d')).toBe(",");
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a last line without a newline", () => {
    expect(parseCsv("a,b\n1,")).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
  });
});

describe("toCsv", () => {
  it("quotes when needed and guards formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-1500.00")).toBe("-1500.00");
    expect(csvCell("-x")).toBe("'-x");
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("writes a header and CRLF rows", () => {
    const csv = toCsv(
      [{ a: "x", b: 1 }],
      [
        { header: "A", value: (r) => r.a },
        { header: "B", value: (r) => r.b },
      ],
    );
    expect(csv).toBe("A,B\r\nx,1\r\n");
  });

  it("formats minor units and bp without locale", () => {
    expect(minorToCsv(-123450)).toBe("-1234.50");
    expect(minorToCsv(5)).toBe("0.05");
    expect(minorToCsv(1200, 0)).toBe("1200");
    expect(bpToCsv(1234)).toBe("12.34");
    expect(bpToCsv(null)).toBe("");
  });
});
