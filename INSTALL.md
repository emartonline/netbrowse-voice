cd ~
wget https://github.com/emartonline/netbrowse-voice/releases/download/v0.32.2/netbrowse-voice-0.32.2.tar.gz
wget https://github.com/emartonline/netbrowse-voice/releases/download/v0.32.2/netbrowse-voice-0.32.2.tar.gz.sha256
sha256sum -c netbrowse-voice-0.32.2.tar.gz.sha256
tar -xzf netbrowse-voice-0.32.2.tar.gz
cd ~/netbrowse-voice-0.32.2
sudo bash installer/install.sh
sudo nbvoice status
