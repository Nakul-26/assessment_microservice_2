FROM python:3.10-slim
WORKDIR /app
COPY judge-service/wrappers/python_runner.py .
CMD ["python", "python_runner.py"]
