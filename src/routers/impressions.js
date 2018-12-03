const {Router} = require('express');
const bodyParser = require('body-parser');
const ow = require('ow');
const {pickBy} = require('lodash');
const {ObjectId} = require('mongodb');
const createError = require('http-errors');
const {asyncHandler} = require('../handler');

module.exports = ({db}) => {
	const router = new Router();
	router.use(bodyParser.json());
	router.post(
		'/impression',
		asyncHandler(async request => {
			const {
				identifier,
				content,
				content_id,
				level,
				platform,
				language,
				direction,
				version
			} = request.body;
			ow(identifier, ow.string);
			ow(content, ow.string);
			ow(level, ow.string);
			ow(platform, ow.any(ow.string, ow.nullOrUndefined));
			ow(content_id, ow.any(ow.string, ow.nullOrUndefined));
			ow(language, ow.any(ow.string, ow.nullOrUndefined));
			ow(direction, ow.any(ow.string, ow.nullOrUndefined));
			ow(version, ow.any(ow.string, ow.nullOrUndefined));
			const impression = pickBy({
				identifier,
				content,
				content_id,
				level,
				platform,
				language,
				version,
				direction,
				date: Date.now()
			});
			const result = await db.insert(impression);
			return {
				impression: result.ops ? result.ops[0] : result
			};
		})
	);

	router.patch(
		'/impression/:id',
		asyncHandler(async request => {
			const {identifier} = request.body;
			const {id} = request.params;
			ow(identifier, ow.string);
			if (id.length !== 24) {
				throw createError(400, 'Impression ID invalid');
			}
			const dbImpression = await db.findOne({
				_id: new ObjectId(id)
			});
			if (!dbImpression) {
				throw createError(404, 'Impression not found');
			}
			if (identifier !== dbImpression.identifier) {
				throw createError(400, 'Should be the same identifier');
			}
			const lastUpdated = Date.now();
			await db.update(
				{
					_id: new ObjectId(id)
				},
				{
					$set: {lastUpdated}
				}
			);
			return {
				impression: {
					...dbImpression,
					lastUpdated
				}
			};
		})
	);
	return router;
};
