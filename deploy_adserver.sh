#!/bin/bash

# usage text visible when --help flag passed in
usage="$(basename "$0") -- deploy the Cliques AdServer

where:
    --help  show this help text
    -e arg (='production') environment flag - either 'dev' or 'production'.  Defaults to production"

# BEGIN environment parsing
env="production"

if [ ! -z $1 ]; then
  if [ $1 == '--help' ]; then
    echo "$usage"
    exit 0
  fi
fi

# fucking getopts
while getopts ":e:" opt; do
  case $opt in
    e)
      if [ "$OPTARG" != 'production' ] && [ "$OPTARG" != 'dev' ]; then
        echo "Invalid environment: $OPTARG.  Environment must be either 'dev' or 'production'"
        exit 1
      else
        env="$OPTARG"
      fi
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      echo "$usage"
      exit 1
      ;;
    :)
      echo "Environment flag -$OPTARG requires an argument (either 'dev' or 'production')" >&2
      exit 1
      ;;
  esac
done
# END environment parsing

# Set proper environment variables now that env is set
if [ "$env" == "production" ]; then
    source ./activate_production.sh
    processname='adserver'
else
    source ./activate_dev.sh
    processname='adserver_dev'
fi

nvm use 0.12.0
npm install

if [ ! -d $HOME"/repositories/cliques-config" ]; then
    git clone git@github.com:cliquesads/cliques-config.git ../cliques-config
    ln -s ../cliques-config config
else
    cd ../cliques-config
    git pull
    cd ../cliques-adserver
fi

running=$(pm2 list -m | grep "$processname")

if [ -z "$running" ]; then
    # hook PM2 up to web monitoring with KeyMetrics
    pm2 link d39yzaslt8iu57e w77ttxdzer9p8zv $HOSTNAME
    # start in cluster mode
    pm2 start index.js --name "$processname" -i 0
else
    pm2 stop "$processname"
    node clear_redis_event_cache.js
    pm2 start "$processname"
fi