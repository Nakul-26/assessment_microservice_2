# judge-service-go/Dockerfile.java (example)
FROM eclipse-temurin:17@sha256:5a66a3ffd8728ed6c76eb4ec674c37991ac679927381f71774f5aa44cf420082

# create a non-root user with home dir and no-login shell
# we create group+user and a consistent UID/GID for reproducibility
ARG JUDGE_USER=judge
ARG JUDGE_UID=1001
ARG JUDGE_GID=1001

RUN groupadd -g ${JUDGE_GID} ${JUDGE_USER} \
 && useradd -m -u ${JUDGE_UID} -g ${JUDGE_GID} -s /usr/sbin/nologin ${JUDGE_USER}

# create app directory and ensure judge owns it
WORKDIR /app
RUN mkdir -p /app && chown -R ${JUDGE_USER}:${JUDGE_USER} /app

# (optionally) install build tools as root here, if needed
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     some-package \
#  && rm -rf /var/lib/apt/lists/*

# copy any runtime artifacts as root, then chown
COPY --chown=${JUDGE_USER}:${JUDGE_USER} . /app

# switch to non-root user for runtime
USER ${JUDGE_USER}

# PATH or environment vars if desired
ENV HOME=/home/${JUDGE_USER}

# default (adjust to your entrypoint)
CMD ["bash"]
