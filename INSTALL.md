# Install Netbrowse Voice

Install Netbrowse Voice on a clean Ubuntu 26.04 server.

## Download v0.32.3

```bash
cd ~
wget https://github.com/emartonline/netbrowse-voice/releases/download/v0.32.3/netbrowse-voice-0.32.3.tar.gz
wget https://github.com/emartonline/netbrowse-voice/releases/download/v0.32.3/netbrowse-voice-0.32.3.tar.gz.sha256
sha256sum -c netbrowse-voice-0.32.3.tar.gz.sha256
tar -xzf netbrowse-voice-0.32.3.tar.gz
cd ~/netbrowse-voice-0.32.3
sudo bash installer/install.sh
```

When installation finishes, open the server address displayed by the installer in your browser and create the first administrator account.

## Upgrade an existing installation

Download and extract the newer release, then run its installer again:

```bash
cd ~
cd ~/netbrowse-voice-0.32.3
sudo bash installer/install.sh
```

The installer preserves existing users, database data and configured credentials.
