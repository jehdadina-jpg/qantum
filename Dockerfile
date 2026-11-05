FROM node:22-slim AS interface
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
RUN useradd -m -u 1000 qantum
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/qantum backend/qantum
COPY backend/data backend/data
COPY --from=interface /app/frontend/dist frontend/dist
COPY frontend/public frontend/public
RUN chown -R qantum /app
USER qantum
WORKDIR /app/backend
ENV QANTUM_HOST=0.0.0.0 QANTUM_PORT=7860 QANTUM_READ_ONLY=1 QANTUM_JOB_WORKERS=1
EXPOSE 7860
CMD ["python", "-m", "qantum"]
