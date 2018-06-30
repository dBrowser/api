const DSiteDB = require('@dwebs/dsitedb')
const dws2 = require('@dwcore/dws2')
const dwsChain = require('@dwcore/dws-chain')
const newDWebID = require('monotonic-timestamp-base36')
const coerce = require('./lib/coerce')

// exported api
// =

exports.open = async function (dsiteDbNameOrPath, userVault, opts) {
  // setup the database
  var ddb = new DSiteDB(dsiteDbNameOrPath, opts)

  ddb.define('profiles', {
    filePattern: '/profile.json',
    index: ['*followUrls'],
    schema: {
      type: 'object',
      properties: {
        name: {type: 'string'},
        bio: {type: 'string'},
        avatar: {type: 'string'},
        follows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: {type: 'string'},
              name: {type: 'string'}
            },
            required: ['url']
          }
        }
      }
    },
    preprocess (record) {
      record.follows = record.follows || []
      record.followUrls = record.follows.map(f => f.url)
      return record
    },
    serialize (record) {
      return {
        name: record.name,
        bio: record.bio,
        avatar: record.avatar,
        follows: record.follows
      }
    }
  })

  ddb.define('bookmarks', {
    filePattern: '/bookmarks/*.json',
    index: [':origin+href', '*tags'],
    schema: {
      type: 'object',
      properties: {
        href: {type: 'string'},
        title: {type: 'string'},
        tags: {type: 'array', items: {type: 'string'}},
        notes: {type: 'string'},
        createdAt: {type: 'number'}
      },
      required: ['href']
    },
    preprocess (record) {
      record.tags = record.tags || []
      return record
    }
  })

  ddb.define('posts', {
    filePattern: '/posts/*.json',
    index: ['createdAt', ':origin+createdAt', 'threadRoot', 'threadParent'],
    schema: {
      type: 'object',
      properties: {
        text: {type: 'string'},
        threadRoot: {type: 'string'},
        threadParent: {type: 'string'},
        createdAt: {type: 'number'}
      },
      required: ['text', 'createdAt']
    }
  })

  ddb.define('vaults', {
    filePattern: '/vaults/*.json',
    index: ['createdAt', ':origin+createdAt', 'url'],
    schema: {
      type: 'object',
      properties: {
        url: {type: 'string'},
        title: {type: 'string'},
        description: {type: 'string'},
        type: {type: 'array', items: {type: 'string'}},
        createdAt: {type: 'number'}
      },
      required: ['url']
    },
    preprocess (record) {
      record.createdAt = record.createdAt || 0
      return record
    }
  })

  ddb.define('votes', {
    filePattern: '/votes/*.json',
    index: ['subject', 'subjectType+createdAt', ':origin+createdAt'],
    schema: {
      type: 'object',
      properties: {
        subject: {type: 'string'},
        subjectType: {type: 'string'},
        vote: {type: 'number'},
        createdAt: {type: 'number'}
      },
      required: ['subject', 'vote']
    }
  })

  await ddb.open()
  const internalLevel = ddb.level.sublevel('_internal')
  const pinsLevel = internalLevel.sublevel('pins')

  if (userVault) {
    // index the main user
    await ddb.addSource(userVault)
    await prepareVault(userVault)

    // index the followers
    ddb.profiles.get(userVault).then(async profile => {
      if (profile && profile.followUrls) {
        ddb.addSource(profile.followUrls)
      }
    })
  }

  async function prepareVault (vault) {
    async function mkdir (path) {
      try { await vault.mkdir(path) } catch (e) {}
    }
    await mkdir('bookmarks')
    await mkdir('posts')
    await mkdir('vaults')
    await mkdir('votes')
  }

  return {
    db,
    prepareVault,

    async close ({destroy} = {}) {
      if (db) {
        var name = ddb.name
        await ddb.close()
        if (destroy) {
          await DSiteDB.delete(name)
        }
        this.db = null
      }
    },

    addSource (a) { return ddb.addSource(a) },
    removeSource (a) { return ddb.removeSource(a) },
    listVaults () { return ddb.listVaults() },

    async pruneUnfollowedVaults (userVault) {
      var profile = await ddb.profiles.get(userVault)
      var vaults = ddb.listSources()
      await Promise.all(vaults.map(a => {
        if (profile.followUrls.indexOf(a.url) === -1) {
          return ddb.removeSource(a)
        }
      }))
    },

    // profiles api
    // =

    getProfile (vault) {
      var vaultUrl = coerce.vaultUrl(vault)
      return ddb.profiles.get(vaultUrl + '/profile.json')
    },

    async setProfile (vault, profile) {
      // write data
      var vaultUrl = coerce.vaultUrl(vault)
      profile = coerce.object(profile, {required: true})
      await ddb.profiles.upsert(vaultUrl + '/profile.json', profile)

      // set name
      if ('name' in profile) {
        let title = coerce.string(profile.name) || 'anonymous'
        vault = ddb._vaults[vaultUrl]
        await vault.configure({title: `User: ${title}`})
      }
    },

    async setAvatar (vault, imgData, extension) {
      vault = ddb._vaults[coerce.vaultUrl(vault)]
      const filename = `avatar.${extension}`

      if (vault) {
        await vault.writeFile(filename, imgData)
      }
      return ddb.profiles.upsert(vault.url + '/profile.json', {avatar: filename})
    },

    async follow (vault, target, name) {
      // update the follow record
      var vaultUrl = coerce.vaultUrl(vault)
      var targetUrl = coerce.vaultUrl(target)
      var changes = await ddb.profiles.where(':origin').equals(vaultUrl).update(record => {
        record.follows = record.follows || []
        if (!record.follows.find(f => f.url === targetUrl)) {
          record.follows.push({url: targetUrl, name})
        }
        return record
      })
      if (changes === 0) {
        throw new Error('Failed to follow: no profile record exists. Run setProfile() before follow().')
      }
      // index the target
      await ddb.addSource(target)
    },

    async unfollow (vault, target) {
      // update the follow record
      var vaultUrl = coerce.vaultUrl(vault)
      var targetUrl = coerce.vaultUrl(target)
      var changes = await ddb.profiles.where(':origin').equals(vaultUrl).update(record => {
        record.follows = record.follows || []
        record.follows = record.follows.filter(f => f.url !== targetUrl)
        return record
      })
      if (changes === 0) {
        throw new Error('Failed to unfollow: no profile record exists. Run setProfile() before unfollow().')
      }
      // unindex the target
      await ddb.removeSource(target)
    },

    getFollowersQuery (vault) {
      var vaultUrl = coerce.vaultUrl(vault)
      return ddb.profiles.where('followUrls').equals(vaultUrl)
    },

    listFollowers (vault) {
      return this.getFollowersQuery(vault).toArray()
    },

    countFollowers (vault) {
      return this.getFollowersQuery(vault).count()
    },

    async isFollowing (vaultA, vaultB) {
      var vaultAUrl = coerce.vaultUrl(vaultA)
      var vaultBUrl = coerce.vaultUrl(vaultB)
      var profileA = await ddb.profiles.get(vaultAUrl + '/profile.json')
      return profileA.followUrls.indexOf(vaultBUrl) !== -1
    },

    async listFriends (vault) {
      var followers = await this.listFollowers(vault)
      await Promise.all(followers.map(async follower => {
        follower.isFriend = await this.isFollowing(vault, follower.getRecordOrigin())
      }))
      return followers.filter(f => f.isFriend)
    },

    async countFriends (vault) {
      var friends = await this.listFriends(vault)
      return friends.length
    },

    async isFriendsWith (vaultA, vaultB) {
      var [a, b] = await Promise.all([
        this.isFollowing(vaultA, vaultB),
        this.isFollowing(vaultB, vaultA)
      ])
      return a && b
    },

    // bookmarks api
    // =

    async bookmark (vault, href, {title, tags, notes} = {}) {
      var vaultUrl = coerce.vaultUrl(vault)
      href = coerce.string(href)
      title = title && coerce.string(title)
      tags = tags && coerce.arrayOfStrings(tags)
      notes = notes && coerce.string(notes)
      if (!href) throw new Error('Must provide bookmark URL')
      const id = coerce.urlSlug(href)
      const createdAt = Date.now()
      return ddb.bookmarks.upsert(`${vaultUrl}/bookmarks/${id}.json`, {href, title, tags, notes, createdAt})
    },

    async unbookmark (vault, href) {
      var origin = coerce.vaultUrl(vault)
      await ddb.bookmarks.where(':origin+href').equals([origin, href]).delete()
      await this.setBookmarkPinned(href, false)
    },

    getBookmarksQuery ({author, tag, offset, limit, reverse} = {}) {
      var query = ddb.bookmarks.query()
      if (tag) {
        // primary filter by tag
        tag = coerce.arrayOfStrings(tag)
        query.where('tags').equals(tag[0])
        if (tag.length > 1) {
          // anyOf() wont work because that gets all matches, and we want records with all of the given tags
          tag.shift() // drop the first one (already filtering)
          query = query.filter(record => {
            return tag.reduce((agg, t) => agg & record.tags.includes(t), true)
          })
        }
        if (author) {
          // secondary filter on author
          if (Array.isArray(author)) {
            author = author.map(coerce.vaultUrl)
            query = query.filter(record => author.includes(record.getRecordOrigin()))
          } else {
            author = coerce.vaultUrl(author)
            query = query.filter(record => record.getRecordOrigin() === author)
          }
        }
      } else if (author) {
        // primary filter by author
        if (Array.isArray(author)) {
          author = author.map(coerce.vaultUrl)
          query = query.where(':origin').anyOf(...author)
        } else {
          author = coerce.vaultUrl(author)
          query = query.where(':origin').equals(author)
        }
      }
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    async listBookmarks (opts = {}) {
      var promises = []
      var query = this.getBookmarksQuery(opts)
      var bookmarks = await query.toArray()

      // fetch pinned attr
      promises = promises.dwsChain(bookmarks.map(async b => {
        b.pinned = await this.isBookmarkPinned(b.href)
      }))

      // fetch author profile
      if (opts.fetchAuthor) {
        let profiles = {}
        promises = promises.dwsChain(bookmarks.map(async b => {
          if (!profiles[b.getRecordOrigin()]) {
            profiles[b.getRecordOrigin()] = this.getProfile(b.getRecordOrigin())
          }
          b.author = await profiles[b.getRecordOrigin()]
        }))
      }

      await Promise.all(promises)
      return bookmarks
    },

    async getBookmark (vault, href) {
      const origin = coerce.vaultUrl(vault)
      var record = await ddb.bookmarks.where(':origin+href').equals([origin, href]).first()
      if (!record) return null
      record.pinned = await this.isBookmarkPinned(href)
      record.author = await this.getProfile(record.getRecordOrigin())
      return record
    },

    async isBookmarked (vault, href) {
      const origin = coerce.vaultUrl(vault)
      var record = await ddb.bookmarks.where(':origin+href').equals([origin, href]).first()
      return !!record
    },

    async isBookmarkPinned (href) {
      try {
        return await pinsLevel.get(href)
      } catch (e) {
        return false
      }
    },

    async setBookmarkPinned (href, pinned) {
      if (pinned) {
        await pinsLevel.put(href, true)
      } else {
        await pinsLevel.del(href)
      }
    },

    async listPinnedBookmarks (vault) {
      vault = coerce.vaultUrl(vault)
      return new Promise(resolve => {
        pinsLevel.createKeyStream()
          .pipe(dws2.obj(async (href, enc, cb) => {
            try {
              cb(null, await this.getBookmark(vault, href))
            } catch (e) {
              // ignore
              cb()
            }
          }))
          .pipe(dwsChain(resolve))
      })
    },

    async listBookmarkTags () {
      return ddb.bookmarks.orderBy('tags').uniqueKeys()
    },

    async countBookmarkTags () {
      var tags = await ddb.bookmarks.orderBy('tags').keys()
      var tagCounts = {}
      tags.forEach(t => {
        tagCounts[t] = (tagCounts[t] || 0) + 1
      })
      return tagCounts
    },

    // posts api
    // =

    post (vault, {text, threadRoot, threadParent}) {
      const vaultUrl = coerce.vaultUrl(vault)
      text = coerce.string(text)
      threadParent = threadParent ? coerce.recordUrl(threadParent) : undefined
      threadRoot = threadRoot ? coerce.recordUrl(threadRoot) : threadParent
      if (!text) throw new Error('Must provide text')
      const createdAt = Date.now()
      return ddb.posts.put(`${vaultUrl}/posts/${newDWebID()}.json`, {text, threadRoot, threadParent, createdAt})
    },

    getPostsQuery ({author, rootPostsOnly, after, before, offset, limit, reverse} = {}) {
      var query = ddb.posts
      if (author) {
        author = coerce.vaultUrl(author)
        after = after || 0
        before = before || Infinity
        query = query.where(':origin+createdAt').between([author, after], [author, before])
      } else if (after || before) {
        after = after || 0
        before = before || Infinity
        query = query.where('createdAt').between(after, before)
      } else {
        query = query.orderBy('createdAt')
      }
      if (rootPostsOnly) {
        query = query.filter(post => !post.threadParent)
      }
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    getRepliesQuery (threadRootUrl, {offset, limit, reverse} = {}) {
      var query = ddb.posts.where('threadRoot').equals(threadRootUrl)
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    async listPosts (opts = {}, query) {
      var promises = []
      query = query || this.getPostsQuery(opts)
      var posts = await query.toArray()

      // fetch author profile
      if (opts.fetchAuthor) {
        let profiles = {}
        promises = promises.dwsChain(posts.map(async b => {
          if (!profiles[b.getRecordOrigin()]) {
            profiles[b.getRecordOrigin()] = this.getProfile(b.getRecordOrigin())
          }
          b.author = await profiles[b.getRecordOrigin()]
        }))
      }

      // tabulate votes
      if (opts.countVotes) {
        promises = promises.dwsChain(posts.map(async b => {
          b.votes = await this.countVotesFor(b.getRecordURL())
        }))
      }

      // fetch replies
      if (opts.fetchReplies) {
        promises = promises.dwsChain(posts.map(async b => {
          b.replies = await this.listPosts({fetchAuthor: true, countVotes: opts.countVotes}, this.getRepliesQuery(b.getRecordURL()))
        }))
      }

      await Promise.all(promises)
      return posts
    },

    countPosts (opts, query) {
      query = query || this.getPostsQuery(opts)
      return query.count()
    },

    async getPost (record) {
      const recordUrl = coerce.recordUrl(record)
      record = await ddb.posts.get(recordUrl)
      if (!record) return null
      record.author = await this.getProfile(record.getRecordOrigin())
      record.votes = await this.countVotesFor(recordUrl)
      record.replies = await this.listPosts({fetchAuthor: true, countVotes: true}, this.getRepliesQuery(recordUrl))
      return record
    },

    // vaults api
    // =

    async publishVault (vault, vaultToPublish) {
      const vaultUrl = coerce.vaultUrl(vault)
      if (typeof vaultToPublish.getInfo === 'function') {
        // fetch info
        let info = await vaultToPublish.getInfo()
        vaultToPublish = {
          url: vaultToPublish.url,
          title: info.title,
          description: info.description,
          type: info.type
        }
      }
      vaultToPublish.url = coerce.vaultUrl(vaultToPublish.url)
      vaultToPublish.createdAt = vaultToPublish.createdAt || Date.now()
      return ddb.vaults.put(`${vaultUrl}/vaults/${newDWebID()}.json`, vaultToPublish)
    },

    async unpublishVault (vault, vaultToUnpublish) {
      const origin = coerce.vaultUrl(vault)
      const url = coerce.vaultUrl(vaultToUnpublish)
      await ddb.vaults
        .where('url').equals(url)
        .filter(record => record.getRecordOrigin() === origin)
        .delete()
    },

    getPublishedVaultsQuery ({author, vault, after, before, offset, limit, reverse} = {}) {
      var query = ddb.vaults
      if (author) {
        author = coerce.vaultUrl(author)
        after = after || 0
        before = before || Infinity
        query = query.where(':origin+createdAt').between([author, after], [author, before])
      } else if (vault) {
        vault = coerce.vaultUrl(vault)
        query = query.where('url').equals(vault)
      } else if (after || before) {
        after = after || 0
        before = before || Infinity
        query = query.where('createdAt').between(after, before)
      } else {
        query = query.orderBy('createdAt')
      }
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    async listPublishedVaults (opts = {}) {
      var promises = []
      var vaults = await this.getPublishedVaultsQuery(opts).toArray()

      // fetch author profile
      if (opts.fetchAuthor) {
        let profiles = {}
        promises = promises.dwsChain(vaults.map(async b => {
          if (!profiles[b.getRecordOrigin()]) {
            profiles[b.getRecordOrigin()] = this.getProfile(b.getRecordOrigin())
          }
          b.author = await profiles[b.getRecordOrigin()]
        }))
      }

      // tabulate votes
      if (opts.countVotes) {
        promises = promises.dwsChain(vaults.map(async b => {
          b.votes = await this.countVotesFor(b.getRecordURL())
        }))
      }

      await Promise.all(promises)
      return vaults
    },

    countPublishedVaults (opts) {
      return this.getPublishedVaultsQuery(opts).count()
    },

    async getPublishedVault (record) {
      const recordUrl = coerce.recordUrl(record)
      record = await ddb.vaults.get(recordUrl)
      if (!record) return null
      record.author = await this.getProfile(record.getRecordOrigin())
      record.votes = await this.countVotesFor(recordUrl)
      return record
    },

    // votes api
    // =

    vote (vault, {vote, subject, subjectType}) {
      const vaultUrl = coerce.vaultUrl(vault)
      vote = coerce.vote(vote)
      subjectType = coerce.string(subjectType)
      if (!subjectType) throw new Error('Subject type is required')
      if (!subject) throw new Error('Subject is required')
      if (subject.getRecordURL) subject = subject.getRecordURL()
      if (subject.url) subject = subject.url
      subject = coerce.url(subject)
      const createdAt = Date.now()
      return ddb.votes.put(`${vaultUrl}/votes/${coerce.urlSlug(subject)}.json`, {vote, subject, subjectType, createdAt})
    },

    getVotesForQuery (subject) {
      return ddb.votes.where('subject').equals(coerce.url(subject))
    },

    getVotesBySubjectTypeQuery (type, {after, before, offset, limit, reverse} = {}) {
      after = after || 0
      before = before || Infinity
      var query = ddb.votes
        .where('subjectType+createdAt')
        .between([type, after], [type, before])
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    getVotesByAuthorQuery (author, {after, before, offset, limit, reverse} = {}) {
      after = after || 0
      before = before || Infinity
      author = coerce.vaultUrl(author)
      var query = ddb.votes
        .where(':origin+createdAt')
        .between([author, after], [author, before])
      if (offset) query = query.offset(offset)
      if (limit) query = query.limit(limit)
      if (reverse) query = query.reverse()
      return query
    },

    listVotesFor (subject) {
      return this.getVotesForQuery(subject).toArray()
    },

    async listVotesBySubjectType (subject, opts = {}) {
      var promises = []
      var votes = await this.getVotesBySubjectTypeQuery(subject, opts).toArray()

      // fetch author profile
      if (opts.fetchAuthor) {
        let profiles = {}
        promises = promises.dwsChain(votes.map(async b => {
          if (!profiles[b.getRecordOrigin()]) {
            profiles[b.getRecordOrigin()] = this.getProfile(b.getRecordOrigin())
          }
          b.author = await profiles[b.getRecordOrigin()]
        }))
      }

      await Promise.all(promises)
      return votes
    },

    listVotesByAuthor (author, opts) {
      return this.getVotesByAuthorQuery(author, opts).toArray()
    },

    async countVotesFor (subject) {
      var res = {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0}
      await this.getVotesForQuery(subject).each(record => {
        res.value += record.vote
        if (record.vote === 1) {
          res.upVoters.push(record.getRecordOrigin())
          res.up++
        }
        if (record.vote === -1) {
          res.down++
        }
        if (userVault && record.getRecordOrigin() === userVault.url) {
          res.currentUsersVote = record.vote
        }
      })
      return res
    }
  }
}
