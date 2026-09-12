import React from "react";
import { Card, CardTitle, CardBadge } from "checklist-kitchen-ds";

export function Required() {
    return (
        <Card variant="list-item">
            <CardTitle>
                SC1 - Food Delivery Records <CardBadge>Required</CardBadge>
            </CardTitle>
        </Card>
    );
}

export function Completed() {
    return (
        <Card variant="list-item" completed>
            <CardTitle>
                SC5 - Opening Checks <CardBadge>Required</CardBadge>
            </CardTitle>
        </Card>
    );
}
