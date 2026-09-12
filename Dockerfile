# Kitchen kiosk (checklist-app). Scoped to exactly one kitchen per running container -
# SAFECATER_KITCHEN_ID is a fixed env var, not a per-request value - so N kitchens means N
# containers, not N replicas of one. No build step (plain HTML/CSS/JS served from src/views/).
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3002
EXPOSE 3002

CMD ["node", "server.js"]
