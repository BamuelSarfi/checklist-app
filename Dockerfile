# Kitchen kiosk (checklist-app). Scoped to exactly one kitchen per running container -
# SAFECATER_KITCHEN_ID is a fixed env var, not a per-request value - so N kitchens means N
# containers, not N replicas of one. No build step of its own (plain HTML/CSS/JS served from
# src/views/), but server.js:614 statically serves design-system/dist, which IS a real build
# output (React/TS -> JS/CSS) and is gitignored - a checkout has no dist/ until this runs.
FROM node:20-alpine AS design-system-build
WORKDIR /app/design-system
COPY design-system/package.json design-system/package-lock.json ./
RUN npm ci
COPY design-system/ .
RUN npm run build

FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
COPY --from=design-system-build /app/design-system/dist ./design-system/dist

ENV NODE_ENV=production
ENV PORT=3002
EXPOSE 3002

CMD ["node", "server.js"]
