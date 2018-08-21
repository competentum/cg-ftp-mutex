const FTP = require('ftp');

class FTPMutex {
  static get DEFAULT_MUTEX_NAME() {
    return '.__DEPLOY_MUTEX__';
  }

  static get DEFAULT_MUTEX_TIMEOUT() {
    return 5; // seconds
  }

  constructor({ host, user, pass, mutex_timeout, path, name }) {
    this._captured = false;

    this._ftpConfig = {
      host,
      user,
      password: pass
    };

    if (name) {
      const name = name.toString().trim();

      if (name) {
        this._name = name;
      }
      else {
        this._name = FTPMutex.DEFAULT_MUTEX_NAME;
      }
    }
    else {
      this._name = FTPMutex.DEFAULT_MUTEX_NAME;
    }

    this._path = this._getMutexPath(path);
    this._timeout = mutex_timeout;
  }


  capture() {
    if (this._captured) {
      throw Error("Mutex already captured.");
    }

    const connection = this._getFtpConnection();
    const dateNow = new Date();

    // return
    return new Promise((resolve, reject) => {
      connection.mkdir(this._path, (err) => {
        if (err) {
          reject(err);
        }
        else {
          resolve(dateNow);
        }
      });
    })
      .then((date) => {
        return new Promise((resolve, reject) => {
          connection.put(Buffer.from(date.toGMTString(), 'utf-8'), `${this._path}/${this._name}`, (err) => {
            if (err) {
              reject(err);
            }
            else {
              connection.end();
              resolve(date);
            }
          });
        });
      })
      .catch((err) => {
        if (err.message === 'Cannot create a file when that file already exists.') {
          return this._getMutexTimestamp(connection)
            .then((timestamp) => {
              if (this._checkMutexTimeout(timestamp, this._timeout)) {
                this.resetMutex(connection);
              }
              else {
                throw new Error(`Synchronization error. Mutex already captured at: ${timestamp}`);
              }
            })
            .catch((err) => {
              if (err.message === 'The system cannot find the file specified.') {
                return this.resetMutex(connection);
              }
              else {
                throw err;
              }
            });
        }
        else {
          throw err;
        }
      });
  }

  free() {

    const connection = this._getFtpConnection();

    return new Promise((resolve, reject) => {
      connection.rmdir(this._path, true, (err) => {
        if (err) {
          reject(err);
        }
        else {
          connection.end();
          resolve(true);
        }
      });
    });
  }

  _getFtpConnection() {
    const client = new FTP();

    client.connect(this._ftpConfig);

    return client;
  }

  _getMutexPath(p) {
    let path = p.toString().trim();

    if (path.length > 0) {
      path += `/${this._name}`;
    }
    else {
      path = this._name;
    }

    return path;
  }

  _checkMutexTimeout(timestamp, timeout = FTPMutex.DEFAULT_MUTEX_TIMEOUT) {
    const mutexTimestamp = new Date(timestamp).getTime();
    const now = new Date();
    const nowUTC = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds()
    );

    return (nowUTC - mutexTimestamp) / 1000 > parseInt(timeout) * 60;
  }

  _getMutexTimestamp(connection) {
    function readMutexFile(stream) {
      let str = "";

      return new Promise((resolve, reject) => {
        stream.on('readable', () => {
          let chunk;

          while ((chunk = stream.read()) !== null) {
            str += chunk.toString();
          }
        });

        stream.on('end', () => resolve(str));
        stream.on('error', (err) => reject(err));
      });
    }

    return new Promise((resolve, reject) => {
      connection.get(`${this._path}/${this._name}`, (err, stream) => {
        if (err) {
          reject(err);
        }
        else {
          resolve(readMutexFile(stream));
        }
      });
    });
  }

  resetMutex(connection) {
    // eslint-disable-next-line no-console
    console.error(`DESTROY CAPTURED FTP MUTEX`);
    return this.free()
      .then(() => {
        connection.end();
        return this.capture();
      });
  }
}

module.exports = FTPMutex;
