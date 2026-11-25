FROM node:22-alpine

WORKDIR /app/Backend

COPY Backend/package*.json ./
RUN npm ci --omit=dev

COPY Backend/Node.js ./Node.js
COPY Backend/database.js ./database.js
COPY Backend/auth.js ./auth.js
COPY Backend/attendance.js ./attendance.js
COPY Backend/redis.js ./redis.js
COPY Backend/mailer.js ./mailer.js
COPY Frontend ../Frontend

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
