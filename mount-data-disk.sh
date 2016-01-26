#!/bin/bash

# REPLACE WITH DISK NAME
DISK_NAME='adserver-dev-data'
MNT_DIR='disk1'

DISK_ROOT_PATH='/dev/disk/by-id/google-'
DISK_PATH="$DISK_ROOT_PATH""$DISK_NAME"
MNT_PATH=/mnt/"$MNT_DIR"

sudo mkdir $MNT_PATH
sudo /usr/share/google/safe_format_and_mount -m "mkfs.ext4 -F" $DISK_PATH $MNT_PATH
sudo chmod a+w $MNT_PATH

# Create necessary directories for all RTBKit installs and
# symlink to home
#
# RTBKit is huge and you do not want to run it from the tiny root disk
# GCE supplies
if [ ! -d $MNT_PATH/.pm2 ]; then
  mkdir $MNT_PATH/.pm2
fi

#create symlinks in home directory
rm -rf /home/bliang/data
rm -rf /home/bliang/.pm2
ln -s $MNT_PATH /home/bliang/data
ln -s $MNT_PATH/.pm2 /home/bliang/.pm2