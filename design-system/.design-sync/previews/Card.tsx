import React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardArrow, CardBadge } from "checklist-kitchen-ds";

export function ListItem() {
    return (
        <Card variant="list-item">
            <div>
                <CardTitle>
                    SC1 - Food Delivery Records <CardBadge>Required</CardBadge>
                </CardTitle>
                <CardDescription>Food delivery conditions and organization check</CardDescription>
            </div>
            <CardArrow />
        </Card>
    );
}

export function Completed() {
    return (
        <Card variant="list-item" completed>
            <div>
                <CardTitle>
                    SC5 - Opening Checks <CardBadge>Required</CardBadge>
                </CardTitle>
                <CardDescription>Daily opening safety checklist</CardDescription>
            </div>
            <CardArrow />
        </Card>
    );
}

export function LibraryResult() {
    return (
        <Card variant="list-item-column">
            <CardHeader>
                <CardTitle>SC1-01-08-2026-Mohammed_Rezavan.pdf</CardTitle>
            </CardHeader>
            <CardDescription>Saved Record · Date: 01/08/2026</CardDescription>
        </Card>
    );
}

export function DeliveryRecord() {
    return (
        <Card variant="record">
            <CardHeader>
                <CardTitle>Record 1/16</CardTitle>
                <CardDescription>29/08/2026</CardDescription>
            </CardHeader>
        </Card>
    );
}

export function Row() {
    return (
        <Card variant="row">
            <CardDescription>Fridge 1 · 3.2°C · 08:15</CardDescription>
        </Card>
    );
}
