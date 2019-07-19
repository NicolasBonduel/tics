import test from 'ava';
import express from 'express';
import got from 'got';
// @ts-ignore
import getPort from 'get-port';
import pify from 'pify';
import {MongoClient} from 'mongodb';
import {sortBy} from 'lodash';
import tics from '../server';
import {create, destroy} from './helpers/db-mock';

test.beforeEach(
	async (t): Promise<void> => {
		const [dbName, userName] = await create();
		const port = await getPort();
		const app = express();
		t.context.port = port;
		t.context.dbName = dbName;
		t.context.dbUrl = `mongodb://${userName}:test@localhost:27017/${dbName}`;
		t.context.db = await MongoClient.connect(t.context.dbUrl, {
			useNewUrlParser: true
		});
		t.context.api = `http://localhost:${t.context.port}`;
		const {impressions, analytics, stats} = tics({
			db: t.context.db.db(t.context.dbName).collection('impressions')
		});
		t.context.stats = stats;
		app.use('/analytics', analytics);
		app.use('/telemetry', impressions);
		await pify(app.listen.bind(app))(port);
	}
);

test.afterEach.always(
	async (t): Promise<void> => {
		await destroy(t.context.dbName);
	}
);

const sendImpression = (api: string, body: any): got.GotPromise<any> => {
	return got.post(`${api}/telemetry/impression`, {
		body,
		headers: {
			'Content-Type': 'application/json'
		},
		json: true
	});
};

const updateImpression = (
	api: string,
	id: string,
	body: any
): got.GotPromise<any> => {
	return got.patch(`${api}/telemetry/impression/${id}`, {
		body,
		headers: {
			'Content-Type': 'application/json'
		},
		json: true
	});
};

const getStats = (api: string): got.GotPromise<any> => {
	return got(`${api}/analytics/stats`, {
		json: true
	});
};

test('Should validate request', async (t): Promise<void> => {
	try {
		await sendImpression(t.context.api, {
			identifier: {
				shouldNotBeObject: 'string'
			}
		});
		t.fail();
	} catch (err) {
		t.is(400, err.statusCode);
	}
});

test('Should accept correct body', async (t): Promise<void> => {
	const response = await sendImpression(t.context.api, {
		identifier: '42037594395',
		content: 'login',
		level: 'click'
	});
	t.true(response.body.success);
	t.is(200, response.statusCode);
});

test('Should successfully add an impression', async (t): Promise<void> => {
	const response = await sendImpression(t.context.api, {
		identifier: '48239740923',
		content: 'login',
		level: 'click'
	});
	t.true(response.body.success);
	t.is(response.body.data.impression._id.length, 24);
	const count = await t.context.db
		.db(t.context.dbName)
		.collection('impressions')
		.countDocuments();
	t.is(count, 1);
});

test('Two impressions by the same user should count as 1 user', async (t): Promise<
	void
> => {
	for (let i = 0; i < 2; i++) {
		await sendImpression(t.context.api, {
			identifier: '48239740923',
			content: 'login',
			level: 'click'
		});
	}
	const stats = await getStats(t.context.api);
	t.is(stats.body.data.activeUsers.daily, 1);
});

test('Should be able to bisect Android and iOS users', async (t): Promise<
	void
> => {
	await sendImpression(t.context.api, {
		identifier: '47389247',
		content: 'login',
		level: 'click',
		platform: 'ios'
	});
	await sendImpression(t.context.api, {
		identifier: '482379749832',
		content: 'login',
		level: 'click',
		platform: 'android'
	});
	const stats = await getStats(t.context.api);
	t.deepEqual(
		sortBy(stats.body.data.breakdown.platform, (p: any): string => p.id),
		[
			{
				id: 'android',
				count: 1
			},
			{
				id: 'ios',
				count: 1
			}
		]
	);
	t.pass();
});

test('Should be able to breakdown installs and registers', async (t): Promise<
	void
> => {
	await sendImpression(t.context.api, {
		identifier: '123456789',
		content: 'register',
		level: 'install',
		platform: 'ios'
	});
	await sendImpression(t.context.api, {
		identifier: '123456789',
		content: 'register',
		level: 'register',
		platform: 'ios'
	});
	const types = await t.context.stats.activityLevels.byContentType('register');
	t.deepEqual(sortBy(types, (_t: any): string => _t.id), [
		{
			id: 'install',
			count: 1
		},
		{
			id: 'register',
			count: 1
		}
	]);
});

test('Should not be able to update an impression that does not exist', async (t): Promise<
	void
> => {
	try {
		await updateImpression(t.context.api, '5be9d22ec0f7f9280fe7beb3', {
			identifier: '123456789'
		});
		t.fail();
	} catch (err) {
		t.is(err.statusCode, 404);
	}
});

test('Should not be able to update an impression that has a different identifier', async (t): Promise<
	void
> => {
	const response = await sendImpression(t.context.api, {
		identifier: '123456789',
		content: 'register',
		level: 'install',
		platform: 'ios'
	});
	try {
		await updateImpression(t.context.api, response.body.data.impression._id, {
			identifier: '987654321'
		});
		t.fail();
	} catch (err) {
		t.is(err.statusCode, 400);
	}
});

test('Should be able to update an impression with correct parameters', async (t): Promise<
	void
> => {
	const response = await sendImpression(t.context.api, {
		identifier: '123456789',
		content: 'register',
		level: 'install',
		platform: 'ios'
	});
	const {body} = await updateImpression(
		t.context.api,
		response.body.data.impression._id,
		{
			identifier: '123456789'
		}
	);
	t.truthy(body.data.impression.lastUpdated);
	t.truthy(body.data.impression.date);
	t.true(body.data.impression.lastUpdated > body.data.impression.date);
});
