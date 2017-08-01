FROM node:4-slim
ENV NPM_CONFIG_LOGLEVEL warn
RUN npm install -g forever
ADD . /deploy/app
WORKDIR /deploy/app
RUN ls
RUN npm install
EXPOSE 3000
CMD forever --spinSleepTime 5000 --fifo app.js
