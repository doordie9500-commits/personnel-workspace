FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8765 DATABASE_PATH=/data/personnel.sqlite3
WORKDIR /app
COPY server.py /app/server.py
COPY updater.py /app/updater.py
COPY admin_extensions.py fullbackup.py preferences.py /app/
COPY web /app/web
RUN useradd --uid 10001 --create-home personnel && mkdir /data && chown personnel:personnel /data
USER personnel
VOLUME /data
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/health')"
CMD ["python", "server.py"]
