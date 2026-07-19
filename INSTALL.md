# Install Netbrowse Voice

This development release is validated on a fresh **Ubuntu Server 26.04
(amd64)** machine. Run it as a sudo-enabled user on the server where Netbrowse
Voice will run.

## Install v0.32.6

```bash
cd ~
sudo apt-get update
sudo apt-get install -y wget

wget https://github.com/emartonline/netbrowse-voice/releases/download/v0.32.6/netbrowse-voice-0.32.6.tar.gz
wget https://github.com/emartonline/netbrowse-voice/releases/download/v0.32.6/netbrowse-voice-0.32.6.tar.gz.sha256

sha256sum -c netbrowse-voice-0.32.6.tar.gz.sha256
tar -xzf netbrowse-voice-0.32.6.tar.gz
cd ~/netbrowse-voice-0.32.6
sudo bash installer/install.sh
```

The checksum command must report:

```text
netbrowse-voice-0.32.6.tar.gz: OK
```

When the installer finishes, open the `http://` address it prints and create
the first administrator account. Check the services at any time with:

```bash
cd ~
sudo nbvoice status
```

## Notes

- The installer creates a 4 GB swap file only when swap is not already enabled.
- It installs and configures Asterisk, PostgreSQL, Redis, Nginx and the
  Netbrowse Voice service.
- Do not run the installer from inside the `.tar.gz` file; extract it first.
