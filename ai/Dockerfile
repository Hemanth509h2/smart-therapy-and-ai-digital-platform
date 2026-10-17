FROM python:3.12-slim
WORKDIR /app
ENV NODE_ENV=production PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py worker.py gunicorn.conf.py ./
COPY stt ./stt
EXPOSE 4100
CMD ["gunicorn"]
