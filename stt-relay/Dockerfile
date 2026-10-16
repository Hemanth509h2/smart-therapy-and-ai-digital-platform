FROM python:3.12-slim
WORKDIR /app
ENV NODE_ENV=production PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py stt_proxy.py ./
EXPOSE 4100
CMD ["python", "server.py"]
