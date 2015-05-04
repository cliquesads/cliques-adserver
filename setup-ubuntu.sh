#!/bin/bash

#system deps
sudo apt-get update
sudo apt-get install gcc make build-essential

#download NVM and install NVM & node
mkdir
curl https://raw.githubusercontent.com/creationix/nvm/v0.24.0/install.sh | NVM_DIR=$HOME/repositories/cliques-adserver/.nvm bash
source .nvm/nvm.sh
nvm install 0.12.0

export NODE_ENV=production

#have to point to the right version of node, npm, pm2, mocha
node_version='0.12.0'
node_path='.nvm/versions/node/v'$node_version'/bin/'
export node=$node_path'node'
export npm=$node_path'npm'
export pm2=$node_path'pm2'
export mocha=$node_path'mocha'

#install node dependencies
npm update
npm install
#have to install pm2 & mocha globally into nvm dir
sudo npm install pm2 -g
sudo npm install mocha -g

#clone config repo and make symlink
if [ ! -d $HOME"/repositories/cliques-config" ]; then
    git clone git@github.com:cliquesads/cliques-config.git ../cliques-config
    ln -s ../cliques-config config
fi