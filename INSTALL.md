```bash
cd ~
wget https://github.com/emartonline/netbrowse-voice/releases/download/v0.32.3/netbrowse-voice-0.32.3.tar.gz
sha256sum netbrowse-voice-0.32.3.tar.gz
```

The command must return this exact checksum:

```text
fd3575b3c3b7429d9ddc76ca47e03ee61ad9e319dfb21baaa83f820e493912f4
```

If it matches, continue:

```bash
cd ~
tar -xzf netbrowse-voice-0.32.3.tar.gz
cd ~/netbrowse-voice-0.32.3
sudo bash installer/install.sh
```
