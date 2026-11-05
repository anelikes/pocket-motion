// The chart's data: one row per month. A template job would write this file
// (or the generator that writes it); the chart itself never changes.

export interface Row {
  readonly month: string;
  readonly value: number;
}

export const ROWS: readonly Row[] = [
  { month: "Jan", value: 22 },
  { month: "Feb", value: 28 },
  { month: "Mar", value: 25 },
  { month: "Apr", value: 41 },
  { month: "May", value: 38 },
  { month: "Jun", value: 52 },
  { month: "Jul", value: 61 },
  { month: "Aug", value: 57 },
  { month: "Sep", value: 70 },
  { month: "Oct", value: 66 },
  { month: "Nov", value: 79 },
  { month: "Dec", value: 88 },
];
