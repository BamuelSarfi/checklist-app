import React from "react";
import "./CalendarDayGrid.css";

export type DayState = "empty" | "missed" | "filled-self" | "filled-other";

export interface CalendarDayGridDay {
    day: number;
    state: DayState;
}

export interface CalendarDayGridProps {
    /** The SC2 monthly grid (sc2.html's #sc2_month_grid) - built from plain
     * CSS-grid divs today, not a real <table>, so this is the closest
     * component analog. */
    days: CalendarDayGridDay[];
    onDayClick?: (day: number) => void;
}

export function CalendarDayGrid({ days, onDayClick }: CalendarDayGridProps) {
    return (
        <div className="ds-calendar-grid">
            {days.map(({ day, state }) => (
                <div
                    key={day}
                    className={`ds-calendar-day${state !== "empty" ? ` ${state}` : ""}`}
                    onClick={() => onDayClick?.(day)}
                    role={onDayClick ? "button" : undefined}
                >
                    {day}
                </div>
            ))}
        </div>
    );
}
