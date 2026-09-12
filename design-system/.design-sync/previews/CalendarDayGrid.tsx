import React from "react";
import { CalendarDayGrid } from "checklist-kitchen-ds";

const AUGUST_2026 = [
    { day: 1, state: "filled-self" },
    { day: 2, state: "filled-self" },
    { day: 3, state: "filled-self" },
    { day: 4, state: "missed" },
    { day: 5, state: "filled-self" },
    { day: 6, state: "filled-self" },
    { day: 7, state: "filled-other" },
    { day: 8, state: "filled-self" },
    { day: 9, state: "filled-self" },
    { day: 10, state: "filled-self" },
    { day: 11, state: "filled-self" },
    { day: 12, state: "missed" },
    { day: 13, state: "filled-self" },
    { day: 14, state: "filled-self" },
    { day: 15, state: "filled-self" },
    { day: 16, state: "filled-self" },
    { day: 17, state: "filled-other" },
    { day: 18, state: "filled-self" },
    { day: 19, state: "filled-self" },
    { day: 20, state: "filled-self" },
    { day: 21, state: "filled-self" },
    { day: 22, state: "filled-self" },
    { day: 23, state: "missed" },
    { day: 24, state: "filled-self" },
    { day: 25, state: "filled-self" },
    { day: 26, state: "filled-self" },
    { day: 27, state: "filled-self" },
    { day: 28, state: "filled-self" },
    { day: 29, state: "filled-self" },
    { day: 30, state: "empty" },
    { day: 31, state: "empty" },
] as const;

export function Default() {
    return <CalendarDayGrid days={[...AUGUST_2026]} onDayClick={() => {}} />;
}
