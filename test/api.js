const dBrowserApiTest = require('ava')
const DPackVault = require('@dpack/vault')
const tempy = require('tempy')
const ProfilesAPI = require('../')
const fs = require('fs')

var ddb

var jared
var stan
var michael

dBrowserApiTest.before('vault creation', async t => {
  // create the vaults
  ;[jared, stan, michael] = await Promise.all([
    DPackVault.create({title: 'Jared', type: ['user-profile'], localPath: tempy.directory()}),
    DPackVault.create({title: 'Stan', type: ['user-profile'], localPath: tempy.directory()}),
    DPackVault.create({title: 'Michael', type: ['user-profile'], localPath: tempy.directory()})
  ])

  // create the db
  ddb = await ProfilesAPI.open(tempy.directory(), jared, {DPackVault})
  await ddb.prepareVault(jared)
  await ddb.prepareVault(stan)
  await ddb.prepareVault(michael)

  // add to database
  await ddb.addSource([jared, stan, michael])
})

dBrowserApiTest.after('close db', async t => {
  await ddb.close()
})

dBrowserApiTest('dBrowser API Test: Profile Data', async t => {
  // write profiles
  await ddb.setProfile(jared, {
    name: 'Jared',
    bio: 'Bench programmer',
    avatar: 'jared.png',
    follows: [{name: 'Stan', url: stan.url}, {name: 'Michael', url: michael.url}]
  })
  t.deepEqual((await jared.getInfo()).title, 'User: Jared')
  await ddb.setProfile(stan, {
    name: 'Stan',
    avatar: 'stan.png',
    bio: 'Bench programmer'
  })

  const avatarBuffer = fs.readFileSync('avatar.jpg').buffer

  await ddb.setAvatar(stan, avatarBuffer, 'jpg')
  await ddb.follow(stan, jared, 'Jared')
  await ddb.setProfile(michael, {
    name: 'Michael'
  })
  await ddb.follow(michael, jared)

  // verify data
  t.truthy(await stan.stat('/avatar.jpg'))
  t.deepEqual(profileSubset(await ddb.getProfile(jared)), {
    name: 'Jared',
    bio: 'Bench programmer',
    avatar: 'jared.png',
    followUrls: [stan.url, michael.url],
    follows: [{name: 'Stan', url: stan.url}, {name: 'Michael', url: michael.url}]
  })
  t.deepEqual(profileSubset(await ddb.getProfile(stan)), {
    name: 'Stan',
    bio: 'Bench programmer',
    avatar: 'avatar.jpg',
    followUrls: [jared.url],
    follows: [{name: 'Jared', url: jared.url}]
  })
  t.deepEqual(profileSubset(await ddb.getProfile(michael)), {
    name: 'Michael',
    bio: undefined,
    avatar: undefined,
    followUrls: [jared.url],
    follows: [{url: jared.url}]
  })
})

dBrowserApiTest('dBrowser API Test: Bookmarks', async t => {
  // bookmarks set/get
  await ddb.bookmark(jared, 'https://dbrowser.io', {
    title: 'dBrowser site',
    notes: 'I love this browser'
  })
  t.deepEqual(await ddb.isBookmarked(jared, 'https://dbrowser.io'), true)
  t.deepEqual(bookmarkSubset(await ddb.getBookmark(jared, 'https://dbrowser.io')), {
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    href: 'https://dbrowser.io',
    title: 'dBrowser site',
    tags: [],
    notes: 'I love this browser',
    pinned: false
  })

  // partial update title
  await ddb.bookmark(jared, 'https://dbrowser.io', {
    title: 'dBrowser Homepage'
  })
  t.deepEqual(bookmarkSubset(await ddb.getBookmark(jared, 'https://dbrowser.io')), {
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    href: 'https://dbrowser.io',
    title: 'dBrowser Homepage',
    tags: [],
    notes: 'I love this browser',
    pinned: false
  })

  // partial update notes
  await ddb.bookmark(jared, 'https://dbrowser.io', {
    notes: 'Bar'
  })
  t.deepEqual(bookmarkSubset(await ddb.getBookmark(jared, 'https://dbrowser.io')), {
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    href: 'https://dbrowser.io',
    title: 'dBrowser Homepage',
    tags: [],
    notes: 'This browser is awesome',
    pinned: false
  })

  // partial update tag (non array)
  await ddb.bookmark(jared, 'https://dbrowser.io', {
    tags: 'tag1'
  })
  t.deepEqual(bookmarkSubset(await ddb.getBookmark(jared, 'https://dbrowser.io')), {
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    href: 'https://dbrowser.io',
    title: 'dBrowser Homepage',
    tags: ['tag1'],
    notes: 'This browser is awesome',
    pinned: false
  })

  // partial update tag (array)
  await ddb.bookmark(jared, 'https://dbrowser.io', {
    tags: ['tag1', 'tag2']
  })
  t.deepEqual(bookmarkSubset(await ddb.getBookmark(jared, 'https://dbrowser.io')), {
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    href: 'https://dbrowser.io',
    title: 'dBrowser Homepage',
    tags: ['tag1', 'tag2'],
    notes: 'This browser is awesome',
    pinned: false
  })

  // bookmark pinning
  await ddb.setBookmarkPinned('https://dbrowser.io', true)
  t.deepEqual(bookmarkSubset(await ddb.getBookmark(jared, 'https://dbrowser.io')), {
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    href: 'https://dbrowser.io',
    title: 'dBrowser Homepage',
    tags: ['tag1', 'tag2'],
    notes: 'This browser is awesome',
    pinned: true
  })
  await ddb.setBookmarkPinned('https://dbrowser.io', false)
  await ddb.setBookmarkPinned('https://dbrowser.io', false) // second time cause problems?
  t.deepEqual(bookmarkSubset(await ddb.getBookmark(jared, 'https://dbrowser.io')), {
    author: true, // bookmarkSubset() just gives us a bool for whether it's present
    href: 'https://dbrowser.io',
    title: 'dBrowser Homepage',
    tags: ['tag1', 'tag2'],
    notes: 'This browser is awesome',
    pinned: false
  })
  await ddb.setBookmarkPinned('https://dbrowser.io', true)

  // bookmark queries
  await ddb.bookmark(stan, 'https://dbrowser.io', {
    title: 'dBrowser site',
    tags: 'tag1'
  })
  await ddb.bookmark(michael, 'http://docs.dbrowser.io', {
    title: 'dBrowser docs'
  })

  // list all
  t.deepEqual(bookmarkSubsets(await ddb.listBookmarks({fetchAuthor: true})), [
    {
      author: true, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'http://docs.dbrowser.io',
      title: 'dBrowser docs',
      tags: [],
      notes: undefined,
      pinned: false
    },
    {
      author: true, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'This browser is awesome',
      pinned: true
    },
    {
      author: true, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser site',
      tags: ['tag1'],
      notes: undefined,
      pinned: true
    }
  ])

  // list by 1 tag
  t.deepEqual(bookmarkSubsets(await ddb.listBookmarks({tag: 'tag1'})), [
    {
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'This browser is awesome',
      pinned: true
    },
    {
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser site',
      tags: ['tag1'],
      notes: undefined,
      pinned: true
    }
  ])

  // list by 2 tags
  t.deepEqual(bookmarkSubsets(await ddb.listBookmarks({tag: ['tag1', 'tag2']})), [
    {
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'This browser is awesome',
      pinned: true
    }
  ])

  // list by 1 author
  t.deepEqual(bookmarkSubsets(await ddb.listBookmarks({author: jared})), [
    {
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'This browser is awesome',
      pinned: true
    }
  ])

  // list by 2 authors
  t.deepEqual(bookmarkSubsets(await ddb.listBookmarks({author: [jared, stan]})), [
    {
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'This browser is awesome',
      pinned: true
    },
    {
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser site',
      tags: ['tag1'],
      notes: undefined,
      pinned: true
    }
  ])

  // list by 1 tag & 1 author
  t.deepEqual(bookmarkSubsets(await ddb.listBookmarks({tag: 'tag1', author: stan})), [
    {
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser site',
      tags: ['tag1'],
      notes: undefined,
      pinned: true
    }
  ])

  // list by 1 tag & 2 authors
  t.deepEqual(bookmarkSubsets(await ddb.listBookmarks({tag: 'tag1', author: [jared, stan]})), [
    {
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'This browser is awesome',
      pinned: true
    },
    {
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser site',
      tags: ['tag1'],
      notes: undefined,
      pinned: true
    }
  ])

  // list by 2 tags & 2 authors
  t.deepEqual(bookmarkSubsets(await ddb.listBookmarks({tag: ['tag1', 'tag2'], author: [jared, stan]})), [
    {
      author: false, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'This browser is awesome',
      pinned: true
    }
  ])

  // list pinned bookmarks
  t.deepEqual(bookmarkSubsets(await ddb.listPinnedBookmarks(jared)), [
    {
      author: true, // bookmarkSubset() just gives us a bool for whether it's present
      href: 'https://dbrowser.io',
      title: 'dBrowser Homepage',
      tags: ['tag1', 'tag2'],
      notes: 'This browser is awesome',
      pinned: true
    }
  ])

  // list & count tags
  t.deepEqual(await ddb.listBookmarkTags(), ['tag1', 'tag2'])
  t.deepEqual(await ddb.countBookmarkTags(), {tag1: 3, tag2: 2})

  // unbookmark
  await ddb.unbookmark(jared, 'https://dbrowser.io')
  t.deepEqual(await ddb.isBookmarked(jared, 'https://dbrowser.io'), false)
  t.falsy(await ddb.getBookmark(jared, 'https://dbrowser.io'))
})

dBrowserApiTest('dBrowser API Test: Votes', async t => {
  // vote
  await ddb.vote(jared, {subject: 'https://dbrowser.io', subjectType: 'dsite', vote: 1})
  await ddb.vote(stan, {subject: 'https://dbrowser.io', subjectType: 'dsite', vote: 2}) // should coerce to 1
  await ddb.vote(michael, {subject: 'https://dbrowser.io', subjectType: 'dsite', vote: 1})
  await ddb.vote(jared, {subject: 'dweb://dbrowser.io', subjectType: 'dsite', vote: 1})
  await ddb.vote(stan, {subject: 'dweb://dbrowser.io', subjectType: 'dsite', vote: 0})
  await ddb.vote(michael, {subject: 'dweb://dbrowser.io', subjectType: 'dsite', vote: -1})
  await ddb.vote(jared, {subject: 'dweb://stan.com/posts/1.json', subjectType: 'post', vote: -1})
  await ddb.vote(stan, {subject: 'dweb://stan.com/posts/1.json', subjectType: 'post', vote: -1})
  await ddb.vote(michael, {subject: 'dweb://stan.com/posts/1.json', subjectType: 'post', vote: -1})

  // listVotesFor

  // simple usage
  t.deepEqual(voteSubsets(await ddb.listVotesFor('https://dbrowser.io')), [
    { subject: 'https://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false },
    { subject: 'https://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false },
    { subject: 'https://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false }
  ])
  // url is normalized
  t.deepEqual(voteSubsets(await ddb.listVotesFor('https://dbrowser.io/')), [
    { subject: 'https://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false },
    { subject: 'https://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false },
    { subject: 'https://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false }
  ])
  // simple usage
  t.deepEqual(voteSubsets(await ddb.listVotesFor('dweb://dbrowser.io')), [
    { subject: 'dweb://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false },
    { subject: 'dweb://dbrowser.io',
      subjectType: 'dsite',
      vote: 0,
      author: false },
    { subject: 'dweb://dbrowser.io',
      subjectType: 'dsite',
      vote: -1,
      author: false }
  ])
  // simple usage
  t.deepEqual(voteSubsets(await ddb.listVotesFor('dweb://stan.com/posts/1.json')), [
    { subject: 'dweb://stan.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false },
    { subject: 'dweb://stan.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false },
    { subject: 'dweb://stan.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false }
  ])

  // countVotesFor

  // simple usage
  t.deepEqual(await ddb.countVotesFor('https://dbrowser.io'), {
    up: 3,
    down: 0,
    value: 3,
    upVoters: [jared.url, stan.url, michael.url],
    currentUsersVote: 1
  })
  // url is normalized
  t.deepEqual(await ddb.countVotesFor('https://dbrowser.io/'), {
    up: 3,
    down: 0,
    value: 3,
    upVoters: [jared.url, stan.url, michael.url],
    currentUsersVote: 1
  })
  // simple usage
  t.deepEqual(await ddb.countVotesFor('dweb://dbrowser.io'), {
    up: 1,
    down: 1,
    value: 0,
    upVoters: [jared.url],
    currentUsersVote: 1
  })
  // simple usage
  t.deepEqual(await ddb.countVotesFor('dweb://stan.com/posts/1.json'), {
    up: 0,
    down: 3,
    value: -3,
    upVoters: [],
    currentUsersVote: -1
  })

  // listVotesBySubjectType

  // simple usage
  t.deepEqual(voteSubsets(await ddb.listVotesBySubjectType('dsite')), [
    { subject: 'https://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false },
    { subject: 'https://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false },
    { subject: 'https://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false },
    { subject: 'dweb://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false },
    { subject: 'dweb://dbrowser.io',
      subjectType: 'dsite',
      vote: 0,
      author: false },
    { subject: 'dweb://dbrowser.io',
      subjectType: 'dsite',
      vote: -1,
      author: false }
  ])
  // simple usage
  t.deepEqual(voteSubsets(await ddb.listVotesBySubjectType('post')), [
    { subject: 'dweb://stan.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false },
    { subject: 'dweb://stan.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false },
    { subject: 'dweb://stan.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false }
  ])
  // some params
  t.deepEqual(voteSubsets(await ddb.listVotesBySubjectType('dsite', {fetchAuthor: true, limit: 1})), [
    { subject: 'https://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: true }
  ])

  // listVotesByAuthor

  // simple usage
  t.deepEqual(voteSubsets(await ddb.listVotesByAuthor(jared)), [
    { subject: 'https://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false },
    { subject: 'dweb://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false },
    { subject: 'dweb://stan.com/posts/1.json',
      subjectType: 'post',
      vote: -1,
      author: false }
  ])
  // some params
  t.deepEqual(voteSubsets(await ddb.listVotesByAuthor(jared, {limit: 1})), [
    { subject: 'https://dbrowser.io',
      subjectType: 'dsite',
      vote: 1,
      author: false }
  ])
})

dBrowserApiTest('dBrowser API Test: Posts', async t => {
  // make some posts
  var post1Url = await ddb.post(jared, {text: 'First'})
  await ddb.post(stan, {text: 'Second'})
  await ddb.post(michael, {text: 'Third'})
  var reply1Url = await ddb.post(stan, {
    text: 'First reply',
    threadParent: post1Url,
    threadRoot: post1Url
  })
  await ddb.post(michael, {
    text: 'Second reply',
    threadParent: reply1Url,
    threadRoot: post1Url
  })
  await ddb.post(jared, {text: 'Fourth'})

  // add some votes
  await ddb.vote(stan, {vote: 1, subject: post1Url, subjectType: 'post'})
  await ddb.vote(michael, {vote: 1, subject: post1Url, subjectType: 'post'})

  // get a post
  t.deepEqual(postSubset(await ddb.getPost(post1Url)), {
    author: true,
    text: 'First',
    threadParent: undefined,
    threadRoot: undefined,
    votes: {up: 2, down: 0, value: 2, upVoters: [stan.url, michael.url], currentUsersVote: 0},
    replies: [
      {
        author: true,
        text: 'First reply',
        threadParent: post1Url,
        threadRoot: post1Url,
        votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
        replies: undefined
      },
      {
        author: true,
        text: 'Second reply',
        threadParent: reply1Url,
        threadRoot: post1Url,
        votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
        replies: undefined
      }
    ]
  })

  // list posts
  t.deepEqual(postSubsets(await ddb.listPosts()), [
    { author: false,
      text: 'First',
      threadParent: undefined,
      threadRoot: undefined,
      votes: undefined,
      replies: undefined },
    { author: false,
      text: 'Second',
      threadParent: undefined,
      threadRoot: undefined,
      votes: undefined,
      replies: undefined },
    { author: false,
      text: 'Third',
      threadParent: undefined,
      threadRoot: undefined,
      votes: undefined,
      replies: undefined },
    { author: false,
      text: 'First reply',
      threadParent: post1Url,
      threadRoot: post1Url,
      votes: undefined,
      replies: undefined },
    { author: false,
      text: 'Second reply',
      threadParent: reply1Url,
      threadRoot: post1Url,
      votes: undefined,
      replies: undefined },
    { author: false,
      text: 'Fourth',
      threadParent: undefined,
      threadRoot: undefined,
      votes: undefined,
      replies: undefined }
  ])

  // list posts (no replies)
  t.deepEqual(postSubsets(await ddb.listPosts({rootPostsOnly: true})), [
    {
      author: false,
      text: 'First',
      threadParent: undefined,
      threadRoot: undefined,
      votes: undefined,
      replies: undefined
    },
    {
      author: false,
      text: 'Second',
      threadParent: undefined,
      threadRoot: undefined,
      votes: undefined,
      replies: undefined
    },
    {
      author: false,
      text: 'Third',
      threadParent: undefined,
      threadRoot: undefined,
      votes: undefined,
      replies: undefined
    },
    {
      author: false,
      text: 'Fourth',
      threadParent: undefined,
      threadRoot: undefined,
      votes: undefined,
      replies: undefined
    }
  ])

  // list posts (authors, votes, and replies)
  t.deepEqual(postSubsets(await ddb.listPosts({fetchAuthor: true, rootPostsOnly: true, countVotes: true, fetchReplies: true})), [
    {
      author: true,
      text: 'First',
      threadParent: undefined,
      threadRoot: undefined,
      votes: {up: 2, down: 0, value: 2, upVoters: [stan.url, michael.url], currentUsersVote: 0},
      replies: [
        {
          author: true,
          text: 'First reply',
          threadParent: post1Url,
          threadRoot: post1Url,
          votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
          replies: undefined
        },
        {
          author: true,
          text: 'Second reply',
          threadParent: reply1Url,
          threadRoot: post1Url,
          votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
          replies: undefined
        }
      ]
    },
    {
      author: true,
      text: 'Second',
      threadParent: undefined,
      threadRoot: undefined,
      votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
      replies: []
    },
    {
      author: true,
      text: 'Third',
      threadParent: undefined,
      threadRoot: undefined,
      votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
      replies: []
    },
    {
      author: true,
      text: 'Fourth',
      threadParent: undefined,
      threadRoot: undefined,
      votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
      replies: []
    }
  ])

  // list posts (limit, offset, reverse)
  t.deepEqual(postSubsets(await ddb.listPosts({rootPostsOnly: true, limit: 1, offset: 1, fetchAuthor: true, countVotes: true, fetchReplies: true})), [
    {
      author: true,
      text: 'Second',
      threadParent: undefined,
      threadRoot: undefined,
      votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
      replies: []
    }
  ])
  t.deepEqual(postSubsets(await ddb.listPosts({rootPostsOnly: true, reverse: true, limit: 1, offset: 1, fetchAuthor: true, countVotes: true, fetchReplies: true})), [
    {
      author: true,
      text: 'Third',
      threadParent: undefined,
      threadRoot: undefined,
      votes: {up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0},
      replies: []
    }
  ])
})

dBrowserApiTest('dBrowser API Test: Published Vaults', async t => {
  // publish some vaults
  var vaultRecord1Url = await ddb.publishVault(jared, stan)
  await ddb.publishVault(jared, {
    url: michael.url,
    title: 'Michael',
    description: 'My friend michael',
    type: ['other-user-profile']
  })
  await ddb.publishVault(stan, {
    url: jared.url,
    title: 'Jared',
    description: 'My friend jared',
    type: ['other-user-profile']
  })

  // add some votes
  await ddb.vote(stan, {vote: 1, subject: vaultRecord1Url, subjectType: 'vault'})
  await ddb.vote(michael, {vote: 1, subject: vaultRecord1Url, subjectType: 'vault'})

  // get an vault
  t.deepEqual(vaultSubset(await ddb.getPublishedVault(vaultRecord1Url)), {
    url: stan.url,
    author: true,
    title: 'User: Stan',
    description: undefined,
    type: ['user-profile'],
    votes: {up: 2, down: 0, value: 2, upVoters: [stan.url, michael.url], currentUsersVote: 0}
  })

  // list vaults (no params)
  t.deepEqual(vaultSubsets(await ddb.listPublishedVaults()), [
    { url: stan.url,
      title: 'User: Stan',
      description: undefined,
      votes: undefined,
      author: false,
      type: [ 'user-profile' ] },
    { url: michael.url,
      title: 'Michael',
      description: 'My friend michael',
      votes: undefined,
      author: false,
      type: [ 'other-user-profile' ] },
    { url: jared.url,
      title: 'Jared',
      description: 'My friend jared',
      votes: undefined,
      author: false,
      type: [ 'other-user-profile' ] }
  ])

  // list vaults (authors, votes)
  t.deepEqual(vaultSubsets(await ddb.listPublishedVaults({fetchAuthor: true, countVotes: true})), [
    { author: true,
      url: stan.url,
      title: 'User: Stan',
      description: undefined,
      type: [ 'user-profile' ],
      votes:
      { up: 2,
        down: 0,
        value: 2,
        upVoters: [stan.url, michael.url],
        currentUsersVote: 0 } },
    { author: true,
      url: michael.url,
      title: 'Michael',
      description: 'My friend michael',
      type: [ 'other-user-profile' ],
      votes: { up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0 } },
    { author: true,
      url: jared.url,
      title: 'Jared',
      description: 'My friend jared',
      type: [ 'other-user-profile' ],
      votes: { up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0 } }
  ])

  // by vault
  t.deepEqual(vaultSubsets(await ddb.listPublishedVaults({vault: stan, fetchAuthor: true, countVotes: true})), [
    { author: true,
      url: stan.url,
      title: 'User: Stan',
      description: undefined,
      type: [ 'user-profile' ],
      votes:
      { up: 2,
        down: 0,
        value: 2,
        upVoters: [stan.url, michael.url],
        currentUsersVote: 0 } }
  ])
  t.deepEqual(vaultSubsets(await ddb.listPublishedVaults({vault: michael.url, fetchAuthor: true, countVotes: true})), [
    { author: true,
      url: michael.url,
      title: 'Michael',
      description: 'My friend michael',
      type: [ 'other-user-profile' ],
      votes: { up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0 } }
  ])

  // list vaults (limit, offset, reverse)
  t.deepEqual(vaultSubsets(await ddb.listPublishedVaults({limit: 1, offset: 1, fetchAuthor: true, countVotes: true, fetchReplies: true})), [
    { author: true,
      url: michael.url,
      title: 'Michael',
      description: 'My friend michael',
      type: [ 'other-user-profile' ],
      votes: { up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0 } }
  ])
  t.deepEqual(vaultSubsets(await ddb.listPublishedVaults({reverse: true, limit: 1, offset: 1, fetchAuthor: true, countVotes: true, fetchReplies: true})), [
    { author: true,
      url: michael.url,
      title: 'Michael',
      description: 'My friend michael',
      type: [ 'other-user-profile' ],
      votes: { up: 0, down: 0, value: 0, upVoters: [], currentUsersVote: 0 } }
  ])

  // unpublish
  await ddb.unpublishVault(jared, stan)
  t.deepEqual(await ddb.getPublishedVault(vaultRecord1Url), null)
})

function profileSubset (p) {
  return {
    name: p.name,
    bio: p.bio,
    avatar: p.avatar,
    followUrls: p.followUrls,
    follows: p.follows
  }
}

function bookmarkSubsets (bs) {
  bs = bs.map(bookmarkSubset)
  bs.sort((a, b) => a.title.localeCompare(b.title))
  return bs
}

function bookmarkSubset (b) {
  return {
    author: !!b.author,
    href: b.href,
    title: b.title,
    tags: b.tags,
    notes: b.notes,
    pinned: b.pinned
  }
}

function voteSubsets (vs) {
  vs = vs.map(voteSubset)
  vs.sort((a, b) => b.vote - a.vote)
  return vs
}

function voteSubset (v) {
  return {
    subject: v.subject,
    subjectType: v.subjectType,
    vote: v.vote,
    author: !!v.author
  }
}

function postSubsets (ps) {
  ps = ps.map(postSubset)
  return ps
}

function postSubset (p) {
  return {
    author: !!p.author,
    text: p.text,
    threadParent: p.threadParent,
    threadRoot: p.threadRoot,
    votes: p.votes,
    replies: p.replies ? postSubsets(p.replies) : undefined
  }
}

function vaultSubsets (as) {
  as = as.map(vaultSubset)
  return as
}

function vaultSubset (a) {
  return {
    author: !!a.author,
    url: a.url,
    title: a.title,
    description: a.description,
    type: a.type,
    votes: a.votes
  }
}
