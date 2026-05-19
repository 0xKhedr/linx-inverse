from hashlib import md5
import json
import logging
import sqlite3

from requests import Session as Client


logger = logging.getLogger(__name__)


class LinX:
    BASE_URL = 'https://gateway.pancares.com/backend/aidex-x'

    @staticmethod
    def setup_db():
        cursor = sqlite3.connect('./resources/database.db').cursor()

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS cgmRecords (
            cgmRecordId TEXT PRIMARY KEY,
            frontRecordId TEXT NOT NULL,
            userId TEXT NOT NULL,
            sensorId TEXT NOT NULL,

            autoIncrementColumn INTEGER,
            timeOffset INTEGER,

            appTime TEXT NOT NULL,
            appTimeZone TEXT,
            dstOffset INTEGER,

            glucose REAL,
            status INTEGER,
            quality INTEGER,
            glucoseIsValid INTEGER,

            rawOne REAL,
            rawTwo REAL,
            rawVc REAL,
            rawIsValid INTEGER,

            eventWarning INTEGER,

            appCreateTime TEXT,

            trendValue REAL,
            appTimeOffset INTEGER,

            deviceStatus INTEGER,

            smooth REAL,
            smoothState INTEGER
        );
                       
        CREATE INDEX IF NOT EXISTS idx_cgmRecords_appTime
        ON cgmRecords(appTime);
        """)
        cursor.connection.commit()
        logger.debug('Database ready: cgmRecords table ensured.')

        return cursor

    @staticmethod
    def hash_pass(value: str):
        return md5(value.encode('utf-8')).hexdigest()

    def __init__(self, client: Client = Client(), decrypter=None, creds: dict = {'userName': None, 'password': None}):
        self.client = client
        self.client.headers.update({
            'brand': 'linX',
            'app-info': 'com.microtech.aidexx.mgdl,2.5.0',
            'Accept-Language': 'en',
            'Accept-Encoding': 'gzip',
            'Connection': 'Keep-Alive',
            'User-Agent': 'okhttp/4.11.0',
        })

        self.decrypter = decrypter

        self.creds = creds
        if self.creds['password'] is not None:
            self.creds['password'] = LinX.hash_pass(self.creds['password'])

        try:
            with open('./resources/session.json', 'r', encoding='utf-8') as session_file:
                self.session = json.load(session_file)

            self.client.headers.update({
                'x-token': self.session['token'],
                'encryption': 'enabled' if self.decrypter else 'disabled',
            })
            logger.info('Session loaded from resources/session.json.')
        except FileNotFoundError:
            self.session = {}
            logger.info('No session file found; starting without token.')

        self.db = LinX.setup_db()

    def login(self, creds: dict):
        if creds:
            self.creds = creds
            self.creds['password'] = LinX.hash_pass(self.creds['password'])

        logger.info('Logging in via password flow.')
        self.session = self.request('user/loginByPassword', method='POST', json=self.creds)
        self.client.headers.update({'x-token': self.session['token']})
        with open('./resources/session.json', 'w', encoding='utf-8') as session_file:
            json.dump(self.session, session_file, ensure_ascii=False, indent=4)
        logger.info('Login succeeded; session saved.')

    def store_cgm_records(self, userId: str = None, all=False, pageNum: int = 1, pageSize: int = 5000, endAutoIncrementColumn: str = None):
        if userId is None:
            userId = self.session['userId']

        logger.info('Fetching CGM records page=%s size=%s end=%s', pageNum, pageSize, endAutoIncrementColumn)
        cgm_data = self.request('cgmRecord/getCgmRecordsByPageInfo', method='GET', params={
            'userId': userId,
            'pageNum': pageNum,
            'pageSize': pageSize,
            'endAutoIncrementColumn': endAutoIncrementColumn
        })
        if not len(cgm_data) or len(cgm_data) == 1 and cgm_data[0]['autoIncrementColumn'] == endAutoIncrementColumn:
            logger.info('No CGM records returned.')
            return None

        columns = list(cgm_data[0].keys())
        if 'cgmRecordId' not in columns:
            logger.warning('CGM response missing cgmRecordId; skipping insert.')
            return None

        self.db.executemany(f"""
        INSERT INTO cgmRecords ({', '.join(columns)}) VALUES ({', '.join(['?'] * len(columns))})
        ON CONFLICT(cgmRecordId) DO NOTHING;
        """, [tuple(record.get(key) for key in columns) for record in cgm_data])
        self.db.connection.commit()
        logger.info('Inserted %s CGM records (duplicates ignored).', len(cgm_data))

        if all:
            logger.debug('Fetching next page of CGM records.')
            self.store_cgm_records(userId, all, pageNum, pageSize, cgm_data[-1]['autoIncrementColumn'])

    def request(self, url: str, **kwargs):
        logger.debug(f"HTTP {kwargs.get('method', 'GET')} {LinX.BASE_URL}/{url}")
        res = self.client.request(url=f'{LinX.BASE_URL}/{url}', **kwargs)
        logger.debug(f"HTTP {kwargs.get('method', 'GET')} {LinX.BASE_URL}/{url} -> {res.status_code}")

        contentType = res.headers['Content-Type']
        if 'application/json' in contentType:
            body = res.json()
            if self.decrypter:
                body = self.decrypter.decrypt(body['encryptData'])

            data = body.get('data', None)
        else:
            data = res.text

        return data


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')

    with open('./resources/credentials.json', encoding='utf-8') as creds_file:
        creds = json.load(creds_file)

    linx = LinX()
    linx.login(creds)
    linx.store_cgm_records(True)


if __name__ == '__main__':
    main()
